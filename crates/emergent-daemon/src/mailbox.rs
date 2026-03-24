use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailboxMessage {
    pub sender: String,
    pub timestamp: String,
    pub body: String,
}

#[derive(Debug, Default)]
pub struct Mailbox {
    messages: Vec<MailboxMessage>,
}

impl Mailbox {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn deliver(&mut self, message: MailboxMessage) {
        self.messages.push(message);
    }

    pub fn len(&self) -> usize {
        self.messages.len()
    }

    pub fn is_empty(&self) -> bool {
        self.messages.is_empty()
    }

    pub fn read_and_clear(&mut self) -> Vec<MailboxMessage> {
        std::mem::take(&mut self.messages)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deliver_and_read() {
        let mut mailbox = Mailbox::new();
        mailbox.deliver(MailboxMessage {
            sender: "agent-a".into(),
            timestamp: "2026-03-23T12:00:00Z".into(),
            body: "hello".into(),
        });
        assert_eq!(mailbox.len(), 1);
        let messages = mailbox.read_and_clear();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].sender, "agent-a");
        assert_eq!(mailbox.len(), 0);
    }

    #[test]
    fn test_empty_mailbox() {
        let mut mailbox = Mailbox::new();
        let messages = mailbox.read_and_clear();
        assert!(messages.is_empty());
        assert_eq!(mailbox.len(), 0);
    }

    #[test]
    fn test_multiple_messages_preserve_order() {
        let mut mailbox = Mailbox::new();
        mailbox.deliver(MailboxMessage {
            sender: "a".into(),
            timestamp: "2026-03-23T12:00:00Z".into(),
            body: "first".into(),
        });
        mailbox.deliver(MailboxMessage {
            sender: "b".into(),
            timestamp: "2026-03-23T12:01:00Z".into(),
            body: "second".into(),
        });
        let messages = mailbox.read_and_clear();
        assert_eq!(messages[0].body, "first");
        assert_eq!(messages[1].body, "second");
    }
}
