//! Self-signed TLS, so browsers will hand over a microphone.
//!
//! Acoustic calibration needs `getUserMedia`, and every browser refuses that
//! on a plain-HTTP LAN address: `http://192.168.1.50:8080` is not a secure
//! context. Without TLS the project's differentiating feature is unreachable
//! on exactly the devices it was built for.
//!
//! A LAN coordinator cannot obtain a real certificate — there is no public
//! name and no certificate authority will vouch for `192.168.1.50` — so it
//! generates its own. Browsers show a warning the first time, which someone
//! has to accept per device. That is the honest trade, and it is why HTTPS is
//! opt-in rather than the default.
//!
//! The certificate is written to disk and reused, because a certificate that
//! changed on every restart would ask for that warning to be accepted again
//! every time.

use rcgen::{CertificateParams, DistinguishedName, DnType, KeyPair, SanType};
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::path::{Path, PathBuf};

/// How long a generated certificate is valid, in days. Long enough not to
/// interrupt a household, short enough to be a real expiry.
const VALIDITY_DAYS: i64 = 825;

/// A certificate and its private key, both PEM encoded.
#[derive(Debug, Clone)]
pub struct Certificate {
    /// PEM certificate chain.
    pub certificate_pem: String,
    /// PEM private key.
    pub key_pem: String,
    /// Where it was loaded from or written to.
    pub path: Option<PathBuf>,
    /// Whether this run created it.
    pub freshly_generated: bool,
}

/// Loads a certificate from `directory`, generating one if it is absent or no
/// longer covers the addresses the coordinator is reachable at.
///
/// `addresses` should include every IP a device might use, and `names` every
/// hostname. A certificate that omits the address a phone actually typed is
/// rejected by the browser outright rather than merely warned about, so this
/// regenerates when the LAN address changes.
pub fn load_or_generate(directory: &Path, addresses: &[IpAddr], names: &[String]) -> Result<Certificate, String> {
    let certificate_path = directory.join("homesync-cert.pem");
    let key_path = directory.join("homesync-key.pem");

    if let (Ok(certificate_pem), Ok(key_pem)) =
        (std::fs::read_to_string(&certificate_path), std::fs::read_to_string(&key_path))
    {
        if certificate_covers(directory, addresses, names) {
            return Ok(Certificate {
                certificate_pem,
                key_pem,
                path: Some(certificate_path),
                freshly_generated: false,
            });
        }
        tracing::info!("the saved certificate does not cover this machine's current addresses; generating a new one");
    }

    let generated = generate(addresses, names)?;

    std::fs::create_dir_all(directory).map_err(|error| format!("could not create {}: {error}", directory.display()))?;
    std::fs::write(&certificate_path, &generated.certificate_pem)
        .map_err(|error| format!("could not write {}: {error}", certificate_path.display()))?;
    write_private_key(&key_path, &generated.key_pem)?;
    if let Ok(record) = serde_json::to_string_pretty(&CoverageRecord::of(addresses, names)) {
        let _ = std::fs::write(coverage_path(directory), record);
    }

    Ok(Certificate { path: Some(certificate_path), freshly_generated: true, ..generated })
}

/// Writes the private key with owner-only permissions where the platform has
/// them. A world-readable key on a shared machine is a needless mistake.
fn write_private_key(path: &Path, pem: &str) -> Result<(), String> {
    std::fs::write(path, pem).map_err(|error| format!("could not write {}: {error}", path.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Generates a fresh self-signed certificate covering the given addresses.
pub fn generate(addresses: &[IpAddr], names: &[String]) -> Result<Certificate, String> {
    let mut params = CertificateParams::default();

    let mut distinguished_name = DistinguishedName::new();
    distinguished_name.push(DnType::CommonName, "HomeSync coordinator");
    distinguished_name.push(DnType::OrganizationName, "HomeSync");
    params.distinguished_name = distinguished_name;

    let mut subject_alt_names = Vec::new();
    for name in names {
        let trimmed = name.trim_end_matches('.');
        let dns =
            trimmed.to_string().try_into().map_err(|_| format!("'{trimmed}' is not usable as a certificate name"))?;
        subject_alt_names.push(SanType::DnsName(dns));
    }
    for address in addresses {
        subject_alt_names.push(SanType::IpAddress(*address));
    }
    params.subject_alt_names = subject_alt_names;

    params.not_before = rcgen::date_time_ymd(2024, 1, 1);
    let expiry = time::OffsetDateTime::now_utc() + time::Duration::days(VALIDITY_DAYS);
    params.not_after = expiry;

    let key_pair = KeyPair::generate().map_err(|error| format!("could not generate a key: {error}"))?;
    let certificate =
        params.self_signed(&key_pair).map_err(|error| format!("could not sign the certificate: {error}"))?;

    Ok(Certificate {
        certificate_pem: certificate.pem(),
        key_pem: key_pair.serialize_pem(),
        path: None,
        freshly_generated: true,
    })
}

/// The addresses and names a saved certificate was generated for.
///
/// Kept beside the certificate rather than parsed back out of it: reading SANs
/// from DER needs another dependency, and the only question here is whether to
/// regenerate. A certificate that omits the address a phone actually typed is
/// rejected outright by the browser, not merely warned about, so getting this
/// wrong is worse than regenerating unnecessarily.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct CoverageRecord {
    addresses: Vec<String>,
    names: Vec<String>,
}

impl CoverageRecord {
    fn of(addresses: &[IpAddr], names: &[String]) -> Self {
        let mut addresses: Vec<String> = addresses.iter().map(|a| a.to_string()).collect();
        let mut names: Vec<String> = names.iter().map(|n| n.trim_end_matches('.').to_string()).collect();
        // Sorted so the comparison does not depend on interface enumeration
        // order, which is not stable between runs.
        addresses.sort();
        names.sort();
        Self { addresses, names }
    }
}

fn coverage_path(directory: &Path) -> PathBuf {
    directory.join("homesync-cert-names.json")
}

/// Whether the saved certificate still covers everything it needs to.
fn certificate_covers(directory: &Path, addresses: &[IpAddr], names: &[String]) -> bool {
    let Ok(text) = std::fs::read_to_string(coverage_path(directory)) else {
        // A hand-supplied certificate, or one from an older build. Leave it
        // alone: replacing somebody's own certificate would be rude.
        return true;
    };
    match serde_json::from_str::<CoverageRecord>(&text) {
        Ok(saved) => saved == CoverageRecord::of(addresses, names),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("homesync-tls-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn generates_a_usable_certificate_and_key() {
        let addresses = vec!["127.0.0.1".parse().unwrap(), "192.168.1.50".parse().unwrap()];
        let names = vec!["localhost".to_string(), "homesync.local".to_string()];

        let generated = generate(&addresses, &names).expect("generate");

        assert!(generated.certificate_pem.starts_with("-----BEGIN CERTIFICATE-----"));
        assert!(generated.key_pem.contains("PRIVATE KEY"));
        // A certificate rustls cannot parse would fail at connection time,
        // which is far harder to diagnose than failing here.
        let parsed: Vec<_> =
            rustls_pemfile::certs(&mut generated.certificate_pem.as_bytes()).collect::<Result<_, _>>().expect("parse");
        assert_eq!(parsed.len(), 1, "expected exactly one certificate");
        let key = rustls_pemfile::private_key(&mut generated.key_pem.as_bytes()).expect("parse key");
        assert!(key.is_some(), "the private key must be readable by rustls");
    }

    #[test]
    fn a_generated_certificate_is_reused_rather_than_replaced() {
        // Regenerating on every start would ask the user to accept a browser
        // warning again on every device, every time.
        let directory = temp_dir("reuse");
        let addresses = vec!["127.0.0.1".parse().unwrap()];
        let names = vec!["localhost".to_string()];

        let first = load_or_generate(&directory, &addresses, &names).expect("first");
        assert!(first.freshly_generated);

        let second = load_or_generate(&directory, &addresses, &names).expect("second");
        assert!(!second.freshly_generated, "the second start must reuse the saved certificate");
        assert_eq!(first.certificate_pem, second.certificate_pem);

        let _ = std::fs::remove_dir_all(&directory);
    }

    #[cfg(unix)]
    #[test]
    fn the_private_key_is_not_world_readable() {
        use std::os::unix::fs::PermissionsExt;
        let directory = temp_dir("perms");
        load_or_generate(&directory, &["127.0.0.1".parse().unwrap()], &["localhost".to_string()]).expect("generate");

        let mode = std::fs::metadata(directory.join("homesync-key.pem")).expect("key exists").permissions().mode();
        assert_eq!(mode & 0o077, 0, "the private key must not be readable by others");

        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_changed_lan_address_forces_regeneration() {
        // DHCP hands out a different address and the old certificate becomes
        // useless: browsers reject a wrong-address certificate outright rather
        // than warning about it.
        let directory = temp_dir("rotate");
        let names = vec!["localhost".to_string()];

        let first = load_or_generate(&directory, &["192.168.1.50".parse().unwrap()], &names).expect("first");
        let second = load_or_generate(&directory, &["192.168.1.77".parse().unwrap()], &names).expect("second");

        assert!(second.freshly_generated, "a new address must produce a new certificate");
        assert_ne!(first.certificate_pem, second.certificate_pem);

        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn address_order_does_not_cause_pointless_regeneration() {
        let directory = temp_dir("order");
        let a: IpAddr = "192.168.1.50".parse().unwrap();
        let b: IpAddr = "127.0.0.1".parse().unwrap();
        let names = vec!["localhost".to_string()];

        load_or_generate(&directory, &[a, b], &names).expect("first");
        let second = load_or_generate(&directory, &[b, a], &names).expect("second");

        assert!(!second.freshly_generated, "interface order must not invalidate the certificate");

        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_certificate_with_no_names_is_still_generated() {
        // Degenerate but harmless: a coordinator reachable only by an address
        // it could not determine.
        let generated = generate(&[], &[]).expect("generate");
        assert!(generated.certificate_pem.contains("BEGIN CERTIFICATE"));
    }
}
