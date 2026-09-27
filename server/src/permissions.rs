use serde::{Deserialize, Serialize};

#[allow(dead_code)]
pub mod perm {
    pub const WILDCARD: &str = "*";
    pub const USER_MANAGE: &str = "user.manage";
    pub const INVITE_UNLIMITED: &str = "invite.unlimited";
    pub const INVITE_LIMITED: &str = "invite.limited";
    pub const CONFIG_EDIT: &str = "config.edit";
    pub const ROOM_FORCE_DELETE: &str = "room.force_delete";
    pub const BACKUP_MANAGE: &str = "backup.manage";
    pub const ROOM_CREATE: &str = "room.create";
    pub const ROOM_JOIN: &str = "room.join";
    pub const MESSAGE_SEND: &str = "message.send";
}

#[derive(thiserror::Error, Debug)]
pub enum PermissionError {
    #[error("invalid json: {0}")]
    InvalidJson(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Permissions(Vec<String>);

impl Permissions {
    pub fn from_json(raw: &str) -> Result<Self, PermissionError> {
        let perms: Vec<String> =
            serde_json::from_str(raw).map_err(|e| PermissionError::InvalidJson(e.to_string()))?;
        Ok(Self(perms))
    }

    #[allow(dead_code)]
    pub fn has(&self, permission: &str) -> bool {
        self.0
            .iter()
            .any(|p| p == perm::WILDCARD || p == permission)
    }

    #[allow(dead_code)]
    pub fn has_any(&self, permissions: &[&str]) -> bool {
        permissions.iter().any(|p| self.has(p))
    }

    #[allow(dead_code)]
    pub fn has_all(&self, permissions: &[&str]) -> bool {
        permissions.iter().all(|p| self.has(p))
    }

    #[allow(dead_code)]
    pub fn inner(&self) -> &Vec<String> {
        &self.0
    }
}

#[allow(dead_code)]
pub fn satisfies(granted: &[&str], required: &str) -> bool {
    granted
        .iter()
        .any(|&p| p == perm::WILDCARD || p == required)
}
