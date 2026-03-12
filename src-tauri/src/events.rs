use serde_json::Value;
use std::sync::{Arc, Mutex};

pub trait EventEmitter: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
    fn as_any(&self) -> &dyn std::any::Any;
}

#[derive(Clone, Default)]
pub struct TestEmitter {
    events: Arc<Mutex<Vec<(String, Value)>>>,
}

impl TestEmitter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn events(&self) -> Vec<(String, Value)> {
        self.events.lock().unwrap().clone()
    }

    pub fn has_event(&self, event_name: &str) -> bool {
        self.events
            .lock()
            .unwrap()
            .iter()
            .any(|(name, _)| name == event_name)
    }
}

impl EventEmitter for TestEmitter {
    fn emit(&self, event: &str, payload: Value) {
        self.events
            .lock()
            .unwrap()
            .push((event.to_string(), payload));
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_emitter_collects_events() {
        let emitter = TestEmitter::new();
        emitter.emit("document:changed", serde_json::json!({"path": "test.md"}));
        assert!(emitter.has_event("document:changed"));
        assert!(!emitter.has_event("tree:changed"));
        assert_eq!(emitter.events().len(), 1);
    }
}
