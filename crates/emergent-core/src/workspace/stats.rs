use bollard::container::StatsOptions;
use bollard::Docker;
use emergent_protocol::{ContainerStatsPayload, Notification, WorkspaceId};
use futures_util::StreamExt;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tokio::time::{interval, Duration};
use tokio_util::sync::CancellationToken;

pub struct ContainerStatsPoller;

impl ContainerStatsPoller {
    /// Start a background poller task for the given workspace container.
    ///
    /// Returns the `JoinHandle` and a `CancellationToken`. Cancel the token to
    /// stop the poller; the task will exit cleanly on the next tick.
    pub fn start(
        workspace_id: WorkspaceId,
        container_name: String,
        docker: Docker,
        tx: broadcast::Sender<Notification>,
    ) -> (JoinHandle<()>, CancellationToken) {
        let token = CancellationToken::new();
        let token_clone = token.clone();

        let handle = tokio::spawn(async move {
            run_poller(workspace_id, container_name, docker, tx, token_clone).await;
        });

        (handle, token)
    }
}

async fn run_poller(
    workspace_id: WorkspaceId,
    container_name: String,
    docker: Docker,
    tx: broadcast::Sender<Notification>,
    token: CancellationToken,
) {
    let mut ticker = interval(Duration::from_secs(2));
    let mut last_net_bytes: Option<u64> = None;

    loop {
        tokio::select! {
            _ = token.cancelled() => break,
            _ = ticker.tick() => {
                match poll_once(&docker, &container_name, &workspace_id, &mut last_net_bytes).await {
                    Ok(payload) => {
                        let _ = tx.send(Notification::ContainerStats(payload));
                    }
                    Err(e) => {
                        log::warn!(
                            "stats poller for workspace '{}': container '{}' error — stopping: {}",
                            workspace_id,
                            container_name,
                            e
                        );
                        break;
                    }
                }
            }
        }
    }
}

async fn poll_once(
    docker: &Docker,
    container_name: &str,
    workspace_id: &WorkspaceId,
    last_net_bytes: &mut Option<u64>,
) -> Result<ContainerStatsPayload, String> {
    let options = StatsOptions {
        stream: false,
        one_shot: true,
    };

    let mut stream = docker.stats(container_name, Some(options));

    let stats = stream
        .next()
        .await
        .ok_or_else(|| "stats stream ended without a sample".to_string())?
        .map_err(|e| format!("bollard stats error: {}", e))?;

    drop(stream);

    let cpu_percent = compute_cpu_percent(&stats);
    let (memory_bytes, memory_limit_bytes) = compute_memory(&stats);
    let net_bps = compute_net_bps(&stats, last_net_bytes);

    Ok(ContainerStatsPayload {
        workspace_id: workspace_id.clone(),
        cpu_percent,
        memory_bytes,
        memory_limit_bytes,
        net_bps,
    })
}

fn compute_cpu_percent(stats: &bollard::container::Stats) -> f32 {
    let cpu_delta = stats
        .cpu_stats
        .cpu_usage
        .total_usage
        .saturating_sub(stats.precpu_stats.cpu_usage.total_usage);

    let system_delta = stats
        .cpu_stats
        .system_cpu_usage
        .unwrap_or(0)
        .saturating_sub(stats.precpu_stats.system_cpu_usage.unwrap_or(0));

    if system_delta == 0 {
        return 0.0;
    }

    let online_cpus = stats
        .cpu_stats
        .online_cpus
        .map(|n| n as f64)
        .unwrap_or_else(|| {
            stats
                .cpu_stats
                .cpu_usage
                .percpu_usage
                .as_ref()
                .map(|v| v.len() as f64)
                .unwrap_or(1.0)
        });

    ((cpu_delta as f64 / system_delta as f64) * online_cpus * 100.0) as f32
}

fn compute_memory(stats: &bollard::container::Stats) -> (u64, u64) {
    let usage = stats.memory_stats.usage.unwrap_or(0);
    let limit = stats.memory_stats.limit.unwrap_or(0);

    let cache = match &stats.memory_stats.stats {
        Some(bollard::container::MemoryStatsStats::V1(v1)) => v1.cache,
        Some(bollard::container::MemoryStatsStats::V2(v2)) => v2.inactive_file,
        None => 0,
    };

    let memory_bytes = usage.saturating_sub(cache);
    (memory_bytes, limit)
}

fn compute_net_bps(stats: &bollard::container::Stats, last_net_bytes: &mut Option<u64>) -> u64 {
    let total: u64 = stats
        .networks
        .as_ref()
        .map(|nets| {
            nets.values()
                .map(|n| n.rx_bytes + n.tx_bytes)
                .sum()
        })
        .unwrap_or(0);

    let bps = match *last_net_bytes {
        None => 0,
        // interval is 2 s
        Some(prev) => total.saturating_sub(prev) / 2,
    };

    *last_net_bytes = Some(total);
    bps
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use bollard::container::{
        BlkioStats, CPUStats, CPUUsage, MemoryStats, MemoryStatsStats, MemoryStatsStatsV1,
        NetworkStats, PidsStats, Stats, StorageStats, ThrottlingData,
    };
    use std::collections::HashMap;

    #[allow(clippy::too_many_arguments)]
    fn make_stats(
        cpu_total: u64,
        precpu_total: u64,
        system_cpu: u64,
        presystem_cpu: u64,
        online_cpus: Option<u64>,
        memory_usage: Option<u64>,
        memory_limit: Option<u64>,
        memory_cache: u64,
        networks: Option<HashMap<String, NetworkStats>>,
    ) -> Stats {
        // Build a minimal MemoryStatsStatsV1 — the `cache` field is what we use
        let mem_stats = Some(MemoryStatsStats::V1(MemoryStatsStatsV1 {
            cache: memory_cache,
            dirty: 0,
            mapped_file: 0,
            total_inactive_file: 0,
            pgpgout: 0,
            rss: 0,
            total_mapped_file: 0,
            writeback: 0,
            unevictable: 0,
            pgpgin: 0,
            total_unevictable: 0,
            pgmajfault: 0,
            total_rss: 0,
            total_rss_huge: 0,
            total_writeback: 0,
            total_inactive_anon: 0,
            rss_huge: 0,
            hierarchical_memory_limit: 0,
            total_pgfault: 0,
            total_active_file: 0,
            active_anon: 0,
            total_active_anon: 0,
            total_pgpgout: 0,
            total_cache: 0,
            total_dirty: 0,
            inactive_anon: 0,
            active_file: 0,
            pgfault: 0,
            inactive_file: 0,
            total_pgmajfault: 0,
            total_pgpgin: 0,
            hierarchical_memsw_limit: None,
            shmem: None,
            total_shmem: None,
        }));

        let cpu = CPUStats {
            cpu_usage: CPUUsage {
                total_usage: cpu_total,
                percpu_usage: Some(vec![0u64; online_cpus.unwrap_or(1) as usize]),
                usage_in_usermode: 0,
                usage_in_kernelmode: 0,
            },
            system_cpu_usage: Some(system_cpu),
            online_cpus,
            throttling_data: ThrottlingData {
                periods: 0,
                throttled_periods: 0,
                throttled_time: 0,
            },
        };

        let precpu = CPUStats {
            cpu_usage: CPUUsage {
                total_usage: precpu_total,
                percpu_usage: Some(vec![0u64; online_cpus.unwrap_or(1) as usize]),
                usage_in_usermode: 0,
                usage_in_kernelmode: 0,
            },
            system_cpu_usage: Some(presystem_cpu),
            online_cpus,
            throttling_data: ThrottlingData {
                periods: 0,
                throttled_periods: 0,
                throttled_time: 0,
            },
        };

        Stats {
            read: "".to_string(),
            preread: "".to_string(),
            num_procs: 0,
            pids_stats: PidsStats {
                current: None,
                limit: None,
            },
            network: None,
            networks,
            memory_stats: MemoryStats {
                stats: mem_stats,
                max_usage: None,
                usage: memory_usage,
                failcnt: None,
                limit: memory_limit,
                commit: None,
                commit_peak: None,
                commitbytes: None,
                commitpeakbytes: None,
                privateworkingset: None,
            },
            blkio_stats: BlkioStats {
                io_service_bytes_recursive: None,
                io_serviced_recursive: None,
                io_queue_recursive: None,
                io_service_time_recursive: None,
                io_wait_time_recursive: None,
                io_merged_recursive: None,
                io_time_recursive: None,
                sectors_recursive: None,
            },
            cpu_stats: cpu,
            precpu_stats: precpu,
            storage_stats: StorageStats {
                read_count_normalized: None,
                read_size_bytes: None,
                write_count_normalized: None,
                write_size_bytes: None,
            },
            name: "test".to_string(),
            id: "test-container".to_string(),
        }
    }

    /// Test A: CPU% with synthetic deltas.
    /// cpu_delta=200_000, system_delta=2_000_000, online_cpus=4 → ~40.0%
    #[test]
    fn test_cpu_percent_formula() {
        let stats = make_stats(
            200_000,   // cpu_total
            0,         // precpu_total → cpu_delta = 200_000
            2_000_000, // system_cpu
            0,         // presystem_cpu → system_delta = 2_000_000
            Some(4),   // online_cpus
            None,
            None,
            0,
            None,
        );

        let result = compute_cpu_percent(&stats);
        // (200_000 / 2_000_000) * 4 * 100 = 40.0
        assert!(
            (result - 40.0_f32).abs() < 0.01,
            "expected ~40.0, got {}",
            result
        );
    }

    /// Test B: Net delta — first sample (last=None) → 0; second sample → correct bytes/s.
    #[test]
    fn test_net_bps_delta() {
        let mut last_net_bytes: Option<u64> = None;

        let mut nets = HashMap::new();
        nets.insert(
            "eth0".to_string(),
            NetworkStats {
                rx_bytes: 5_000_000,
                tx_bytes: 0,
                rx_dropped: 0,
                rx_errors: 0,
                rx_packets: 0,
                tx_dropped: 0,
                tx_errors: 0,
                tx_packets: 0,
            },
        );

        let stats1 = make_stats(0, 0, 1, 0, Some(1), None, None, 0, Some(nets));

        // First sample: last=None → net_bps must be 0
        let bps1 = compute_net_bps(&stats1, &mut last_net_bytes);
        assert_eq!(bps1, 0, "first sample should be 0 bps");
        assert_eq!(last_net_bytes, Some(5_000_000));

        // Second sample: total = 5_002_000, interval = 2 s → 1_000 bytes/s
        let mut nets2 = HashMap::new();
        nets2.insert(
            "eth0".to_string(),
            NetworkStats {
                rx_bytes: 5_002_000,
                tx_bytes: 0,
                rx_dropped: 0,
                rx_errors: 0,
                rx_packets: 0,
                tx_dropped: 0,
                tx_errors: 0,
                tx_packets: 0,
            },
        );

        let stats2 = make_stats(0, 0, 1, 0, Some(1), None, None, 0, Some(nets2));
        let bps2 = compute_net_bps(&stats2, &mut last_net_bytes);
        assert_eq!(bps2, 1_000, "expected 1_000 bytes/s, got {}", bps2);
        assert_eq!(last_net_bytes, Some(5_002_000));
    }

    /// Test C: system_delta == 0 clamps cpu_percent to 0.0 (no NaN, no panic).
    #[test]
    fn test_cpu_percent_zero_system_delta() {
        let stats = make_stats(
            100_000, // cpu_total
            50_000,  // precpu_total
            1_000,   // system_cpu
            1_000,   // presystem_cpu → system_delta = 0
            Some(2),
            None,
            None,
            0,
            None,
        );

        let result = compute_cpu_percent(&stats);
        assert_eq!(
            result, 0.0,
            "expected 0.0 when system_delta==0, got {}",
            result
        );
        assert!(!result.is_nan(), "result must not be NaN");
    }
}
