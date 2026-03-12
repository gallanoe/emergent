use serde_json::Value;
#[cfg(test)]
use std::sync::{Arc, Mutex};

pub trait EventEmitter: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
    #[allow(dead_code)]
    fn as_any(&self) -> &dyn std::any::Any;
}

#[cfg(test)]
#[derive(Clone, Default)]
pub struct TestEmitter {
    events: Arc<Mutex<Vec<(String, Value)>>>,
}

#[cfg(test)]
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

#[cfg(test)]
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
