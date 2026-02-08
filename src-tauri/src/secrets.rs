pub fn set_api_key(provider: &str, api_key: &str) -> Result<(), String> {
  let provider = provider.trim();
  if provider.is_empty() {
    return Err("provider empty".to_string());
  }
  let entry = keyring::Entry::new("Iris-Creation", provider).map_err(|e| format!("keyring entry failed: {e}"))?;
  entry
    .set_password(api_key)
    .map_err(|e| format!("set password failed: {e}"))?;
  Ok(())
}

pub fn get_api_key(provider: &str) -> Result<Option<String>, String> {
  let provider = provider.trim();
  if provider.is_empty() {
    return Ok(None);
  }
  let entry = keyring::Entry::new("Iris-Creation", provider).map_err(|e| format!("keyring entry failed: {e}"))?;
  match entry.get_password() {
    Ok(v) => Ok(Some(v)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(e) => Err(format!("get password failed: {e}")),
  }
}
