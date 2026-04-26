use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Tiered subscription mode for task status notifications.
///
/// Controls which lifecycle events are routed to the subscribing session.
///
/// - `Milestones`: delivers `"started"` and `"completed"` notifications only.
/// - `All`: additionally delivers each `"update"` notification posted by the
///   task agent via `update_task`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SubscribeMode {
    /// Deliver start and completion notifications only.
    Milestones,
    /// Deliver start, every progress update, and completion notifications.
    All,
}

impl SubscribeMode {
    /// Returns `true` when this mode should deliver a notification of the given `kind`.
    ///
    /// - `"started"` and `"completed"` are covered by both `Milestones` and `All`.
    /// - `"update"` is covered by `All` only.
    /// - Any unrecognised kind returns `false`.
    pub fn covers(self, kind: &str) -> bool {
        match self {
            SubscribeMode::Milestones => matches!(kind, "started" | "completed"),
            SubscribeMode::All => matches!(kind, "started" | "update" | "completed"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subscribe_mode_serde_roundtrip_milestones() {
        let json = serde_json::to_string(&SubscribeMode::Milestones).unwrap();
        assert_eq!(json, r#""milestones""#);
        let parsed: SubscribeMode = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, SubscribeMode::Milestones);
    }

    #[test]
    fn subscribe_mode_serde_roundtrip_all() {
        let json = serde_json::to_string(&SubscribeMode::All).unwrap();
        assert_eq!(json, r#""all""#);
        let parsed: SubscribeMode = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, SubscribeMode::All);
    }

    #[test]
    fn milestones_covers_started_and_completed() {
        assert!(SubscribeMode::Milestones.covers("started"));
        assert!(SubscribeMode::Milestones.covers("completed"));
        assert!(!SubscribeMode::Milestones.covers("update"));
        assert!(!SubscribeMode::Milestones.covers("unknown"));
    }

    #[test]
    fn all_covers_started_update_and_completed() {
        assert!(SubscribeMode::All.covers("started"));
        assert!(SubscribeMode::All.covers("update"));
        assert!(SubscribeMode::All.covers("completed"));
        assert!(!SubscribeMode::All.covers("unknown"));
    }
}
