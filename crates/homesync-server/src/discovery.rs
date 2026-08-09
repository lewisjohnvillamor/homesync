//! mDNS service advertisement.
//!
//! Publishes `homesync.local` and a `_homesync._tcp` service record, so the
//! coordinator can be reached by name instead of by an IP address somebody had
//! to read off a terminal and type into a television remote.
//!
//! **This does not work everywhere, and the difference matters.** macOS, iOS
//! and Windows 10 or later resolve `.local` names out of the box; desktop
//! Linux does with Avahi installed. **Android does not resolve `.local`
//! hostnames**, so a phone still needs the IP address. The startup banner
//! therefore prints the IP first and the name as a convenience, rather than
//! promising a name that will fail on the most common receiver.

use mdns_sd::{ServiceDaemon, ServiceInfo};
use std::net::IpAddr;

/// Service type advertised on the network.
pub const SERVICE_TYPE: &str = "_homesync._tcp.local.";

/// The hostname published for the coordinator.
pub const HOSTNAME: &str = "homesync.local.";

/// A running advertisement. Dropping it withdraws the record.
pub struct Advertisement {
    daemon: ServiceDaemon,
    full_name: String,
}

impl Advertisement {
    /// Publishes the coordinator on the local network.
    ///
    /// Returns `Err` with a human-readable reason when the platform will not
    /// allow it — a container without multicast, a firewall, another daemon
    /// holding the port. That is a degraded experience, not a failure to
    /// start, so the caller logs it and carries on with IP addresses.
    pub fn publish(ip: IpAddr, port: u16, room_code: &str, tls: bool) -> Result<Self, String> {
        let daemon = ServiceDaemon::new().map_err(|error| format!("could not start the mDNS daemon: {error}"))?;

        let properties = [
            ("version", env!("CARGO_PKG_VERSION")),
            ("protocol", "1"),
            ("room", room_code),
            ("scheme", if tls { "https" } else { "http" }),
        ];

        let service = ServiceInfo::new(SERVICE_TYPE, "HomeSync", HOSTNAME, ip, port, &properties[..])
            .map_err(|error| format!("could not build the mDNS record: {error}"))?;

        let full_name = service.get_fullname().to_string();
        daemon.register(service).map_err(|error| format!("could not publish the mDNS record: {error}"))?;

        Ok(Self { daemon, full_name })
    }

    /// The advertised service instance name.
    pub fn full_name(&self) -> &str {
        &self.full_name
    }
}

impl Drop for Advertisement {
    fn drop(&mut self) {
        // Best effort: tell the network the service is going away rather than
        // leaving a stale record other devices will try to reach.
        let _ = self.daemon.unregister(&self.full_name);
        let _ = self.daemon.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_service_type_is_a_well_formed_mdns_name() {
        // A missing trailing dot or a wrong protocol suffix makes the record
        // silently unresolvable, which is hard to notice and hard to debug.
        assert!(SERVICE_TYPE.ends_with(".local."), "service type must be fully qualified");
        assert!(SERVICE_TYPE.starts_with('_'), "service type must start with an underscore");
        assert!(SERVICE_TYPE.contains("._tcp."), "HomeSync runs over TCP");
        assert!(HOSTNAME.ends_with('.'), "hostname must be fully qualified");
    }

    #[test]
    fn publishing_reports_failure_instead_of_panicking() {
        // Containers and locked-down networks routinely refuse multicast. The
        // coordinator must survive that; it only loses a convenience.
        let result = Advertisement::publish("127.0.0.1".parse().unwrap(), 8080, "ABC123", false);
        match result {
            Ok(advertisement) => {
                assert!(advertisement.full_name().contains("HomeSync"));
            }
            Err(error) => {
                assert!(!error.is_empty(), "a failure must explain itself");
            }
        }
    }
}
