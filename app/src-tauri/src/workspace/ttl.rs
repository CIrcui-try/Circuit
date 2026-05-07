//! Idle-TTL monitor — populated in later commits within CIR-30.
use std::time::Duration;

#[derive(Debug, Clone, Copy)]
pub struct IdleTtlConfig {
    pub ttl: Duration,
    pub poll_interval: Duration,
}

impl Default for IdleTtlConfig {
    fn default() -> Self {
        Self {
            ttl: Duration::from_secs(15 * 60),
            poll_interval: Duration::from_secs(30),
        }
    }
}
