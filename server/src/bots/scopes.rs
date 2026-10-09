use thiserror::Error;

pub const SCOPES: [&str; 8] = [
    "post_message",
    "post_attachment",
    "post_reaction",
    "read_commands",
    "read_metadata",
    "read_content",
    "edit_message",
    "delete_message",
];

pub const READ_CONTENT_DEPENDENTS: [&str; 3] = ["post_reaction", "edit_message", "delete_message"];

#[derive(Error, Debug, PartialEq, Eq)]
pub enum ScopeError {
    #[error("out_of_vocabulary: {0}")]
    OutOfVocabulary(String),
    #[error("scope_dependency_missing")]
    DependencyMissing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    WriteOnly,
    Observer,
    Member,
}

impl Mode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Mode::WriteOnly => "write_only",
            Mode::Observer => "observer",
            Mode::Member => "member",
        }
    }
}

impl std::fmt::Display for Mode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

pub fn is_valid_scope(scope: &str) -> bool {
    SCOPES.contains(&scope)
}

pub fn validate_scopes(scopes: &[String]) -> Result<(), ScopeError> {
    for s in scopes {
        if !is_valid_scope(s) {
            return Err(ScopeError::OutOfVocabulary(s.clone()));
        }
    }

    validate_dependencies(scopes)?;

    Ok(())
}

pub fn validate_dependencies(scopes: &[String]) -> Result<(), ScopeError> {
    let has_read_content = scopes.iter().any(|s| s == "read_content");
    let has_dependent = scopes
        .iter()
        .any(|s| READ_CONTENT_DEPENDENTS.contains(&s.as_str()));

    if has_dependent && !has_read_content {
        return Err(ScopeError::DependencyMissing);
    }

    Ok(())
}

pub fn derive_mode(scopes: &[String]) -> Mode {
    if scopes.iter().any(|s| {
        matches!(
            s.as_str(),
            "read_content" | "post_reaction" | "edit_message" | "delete_message"
        )
    }) {
        Mode::Member
    } else if scopes.iter().any(|s| s == "read_metadata") {
        Mode::Observer
    } else {
        Mode::WriteOnly
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_scopes_ok() {
        let scopes = vec!["post_message".to_string(), "read_content".to_string()];
        assert!(validate_scopes(&scopes).is_ok());
    }

    #[test]
    fn test_validate_scopes_out_of_vocabulary() {
        let scopes = vec!["post_message".to_string(), "invalid_scope".to_string()];
        assert_eq!(
            validate_scopes(&scopes),
            Err(ScopeError::OutOfVocabulary("invalid_scope".to_string()))
        );
    }

    #[test]
    fn test_validate_scopes_dependency_missing() {
        let scopes = vec!["post_reaction".to_string()];
        assert_eq!(validate_scopes(&scopes), Err(ScopeError::DependencyMissing));
    }

    #[test]
    fn test_derive_mode() {
        assert_eq!(derive_mode(&["post_message".to_string()]), Mode::WriteOnly);
        assert_eq!(derive_mode(&["read_metadata".to_string()]), Mode::Observer);
        assert_eq!(derive_mode(&["read_content".to_string()]), Mode::Member);
        assert_eq!(
            derive_mode(&["post_reaction".to_string(), "read_content".to_string()]),
            Mode::Member
        );
    }
}
