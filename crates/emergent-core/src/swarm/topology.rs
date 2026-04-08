use std::collections::HashSet;

#[derive(Debug, Default)]
pub struct Topology {
    edges: HashSet<(String, String)>,
}

impl Topology {
    pub fn new() -> Self {
        Self::default()
    }

    /// Store edges in canonical order (smaller first) for dedup.
    fn canonical(a: &str, b: &str) -> (String, String) {
        if a <= b {
            (a.to_string(), b.to_string())
        } else {
            (b.to_string(), a.to_string())
        }
    }

    pub fn connect(&mut self, a: &str, b: &str) {
        if a != b {
            self.edges.insert(Self::canonical(a, b));
        }
    }

    pub fn disconnect(&mut self, a: &str, b: &str) {
        self.edges.remove(&Self::canonical(a, b));
    }

    pub fn is_connected(&self, a: &str, b: &str) -> bool {
        self.edges.contains(&Self::canonical(a, b))
    }

    pub fn peers(&self, node_id: &str) -> Vec<String> {
        let mut result = Vec::new();
        for (a, b) in &self.edges {
            if a == node_id {
                result.push(b.clone());
            } else if b == node_id {
                result.push(a.clone());
            }
        }
        result.sort();
        result
    }

    pub fn remove_node(&mut self, node_id: &str) {
        self.edges.retain(|(a, b)| a != node_id && b != node_id);
    }

    pub fn edges(&self) -> Vec<(String, String)> {
        let mut result: Vec<_> = self.edges.iter().cloned().collect();
        result.sort();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_connect_and_peers() {
        let mut topology = Topology::new();
        topology.connect("a", "b");
        assert_eq!(topology.peers("a"), vec!["b".to_string()]);
        assert_eq!(topology.peers("b"), vec!["a".to_string()]);
    }

    #[test]
    fn test_disconnect() {
        let mut topology = Topology::new();
        topology.connect("a", "b");
        topology.disconnect("a", "b");
        assert!(topology.peers("a").is_empty());
        assert!(topology.peers("b").is_empty());
    }

    #[test]
    fn test_is_connected() {
        let mut topology = Topology::new();
        assert!(!topology.is_connected("a", "b"));
        topology.connect("a", "b");
        assert!(topology.is_connected("a", "b"));
        assert!(topology.is_connected("b", "a")); // bidirectional
    }

    #[test]
    fn test_remove_node_cleans_edges() {
        let mut topology = Topology::new();
        topology.connect("a", "b");
        topology.connect("a", "c");
        topology.remove_node("a");
        assert!(topology.peers("b").is_empty());
        assert!(topology.peers("c").is_empty());
    }

    #[test]
    fn test_duplicate_connect_is_idempotent() {
        let mut topology = Topology::new();
        topology.connect("a", "b");
        topology.connect("a", "b");
        assert_eq!(topology.peers("a").len(), 1);
    }

    #[test]
    fn test_edges_returns_all() {
        let mut topology = Topology::new();
        topology.connect("a", "b");
        topology.connect("b", "c");
        let edges = topology.edges();
        assert_eq!(edges.len(), 2);
    }
}
