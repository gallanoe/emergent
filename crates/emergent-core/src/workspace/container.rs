use bollard::container::{
    Config, CreateContainerOptions, RemoveContainerOptions, StopContainerOptions,
};
use bollard::image::BuildImageOptions;
use bollard::models::HostConfig;
use bollard::Docker;
use futures_util::StreamExt;
use std::path::Path;

use emergent_protocol::{ContainerStatus, DockerStatus, WorkspaceId};

/// Build a Docker image from a workspace directory containing a Dockerfile.
pub async fn build_image(
    docker: &Docker,
    workspace_id: &WorkspaceId,
    workspace_path: &Path,
) -> Result<String, String> {
    let image_tag = image_tag(workspace_id);

    let tar = create_build_context(workspace_path)
        .map_err(|e| format!("Failed to create build context: {}", e))?;

    let options = BuildImageOptions {
        t: image_tag.as_str(),
        rm: true,
        ..Default::default()
    };

    let mut stream = docker.build_image(options, None, Some(tar.into()));

    while let Some(result) = stream.next().await {
        match result {
            Ok(info) => {
                if let Some(error) = info.error {
                    return Err(format!("Docker build error: {}", error));
                }
                if let Some(stream_msg) = &info.stream {
                    log::debug!("build: {}", stream_msg.trim());
                }
            }
            Err(e) => return Err(format!("Docker build failed: {}", e)),
        }
    }

    Ok(image_tag)
}

/// Create and start a container from a built image.
pub async fn create_and_start_container(
    docker: &Docker,
    workspace_id: &WorkspaceId,
    host_path: &Path,
) -> Result<String, String> {
    let name = container_name(workspace_id);
    let tag = image_tag(workspace_id);

    // Mount the `home/` subdirectory as /home in the container. Metadata,
    // agents.json, and Dockerfile remain outside the mount at the workspace root.
    let mount_path = host_path.join("home");
    let mount_path_str = mount_path
        .to_str()
        .ok_or_else(|| "Workspace path is not valid UTF-8".to_string())?;

    let extra_hosts = if cfg!(target_os = "linux") {
        Some(vec!["host.docker.internal:host-gateway".to_string()])
    } else {
        None
    };

    let config = Config {
        image: Some(tag.as_str()),
        host_config: Some(HostConfig {
            binds: Some(vec![format!("{}:/home", mount_path_str)]),
            extra_hosts,
            ..Default::default()
        }),
        working_dir: Some("/home/workspace"),
        open_stdin: Some(true),
        tty: Some(false),
        ..Default::default()
    };

    let options = CreateContainerOptions {
        name: name.as_str(),
        platform: None,
    };

    // Remove any existing container with the same name (e.g. from a previous run)
    let _ = docker
        .remove_container(
            &name,
            Some(RemoveContainerOptions {
                force: true,
                ..Default::default()
            }),
        )
        .await;

    log::info!("Creating container '{}' from image '{}'", name, tag);
    let response = docker
        .create_container(Some(options), config)
        .await
        .map_err(|e| format!("Failed to create container '{}': {}", name, e))?;

    log::info!("Container created: {}, starting...", response.id);
    docker
        .start_container::<String>(&response.id, None)
        .await
        .map_err(|e| format!("Failed to start container '{}': {}", response.id, e))?;

    log::info!("Container started: {}", response.id);
    Ok(response.id)
}

/// Stop and remove a container.
pub async fn stop_and_remove_container(
    docker: &Docker,
    container_id: &str,
) -> Result<(), String> {
    let stop_options = StopContainerOptions { t: 2 };
    let _ = docker.stop_container(container_id, Some(stop_options)).await;

    let remove_options = RemoveContainerOptions {
        force: true,
        ..Default::default()
    };
    docker
        .remove_container(container_id, Some(remove_options))
        .await
        .map_err(|e| format!("Failed to remove container: {}", e))?;

    Ok(())
}

/// Remove a Docker image.
pub async fn remove_image(docker: &Docker, workspace_id: &WorkspaceId) -> Result<(), String> {
    let tag = image_tag(workspace_id);
    let _ = docker.remove_image(&tag, None, None).await;
    Ok(())
}

/// Query Docker for a container's running status.
pub async fn inspect_container_status(
    docker: &Docker,
    workspace_id: &WorkspaceId,
) -> ContainerStatus {
    let name = container_name(workspace_id);
    match docker.inspect_container(&name, None).await {
        Ok(info) => {
            let running = info
                .state
                .as_ref()
                .and_then(|s| s.running)
                .unwrap_or(false);
            if running {
                ContainerStatus::Running
            } else {
                ContainerStatus::Stopped
            }
        }
        Err(_) => ContainerStatus::Stopped,
    }
}

/// Check Docker availability.
pub async fn detect_docker(docker: &Docker) -> DockerStatus {
    match docker.version().await {
        Ok(version) => DockerStatus {
            docker_available: true,
            docker_version: version.version,
        },
        Err(_) => DockerStatus {
            docker_available: false,
            docker_version: None,
        },
    }
}

/// Create a tar archive from a directory for Docker build context.
fn create_build_context(path: &Path) -> Result<Vec<u8>, std::io::Error> {
    let mut archive = tar::Builder::new(Vec::new());

    fn add_dir_to_archive(
        archive: &mut tar::Builder<Vec<u8>>,
        dir: &Path,
        prefix: &Path,
    ) -> Result<(), std::io::Error> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let entry_path = entry.path();
            let name = entry_path.strip_prefix(prefix).unwrap();

            if entry_path.is_dir() {
                archive.append_dir(name, &entry_path)?;
                add_dir_to_archive(archive, &entry_path, prefix)?;
            } else {
                archive.append_path_with_name(&entry_path, name)?;
            }
        }
        Ok(())
    }

    add_dir_to_archive(&mut archive, path, path)?;
    archive.finish()?;
    archive.into_inner()
}

// ---------------------------------------------------------------------------
// Naming conventions
// ---------------------------------------------------------------------------

pub fn container_name(workspace_id: &WorkspaceId) -> String {
    format!("emergent-{}", workspace_id.0)
}

pub fn image_tag(workspace_id: &WorkspaceId) -> String {
    format!("emergent-workspace-{}:latest", workspace_id.0)
}
