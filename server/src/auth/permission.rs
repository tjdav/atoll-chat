use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Permission {
    Wildcard,
    UserManage,
    InviteUnlimited,
    InviteLimited,
    ConfigEdit,
    RoomForceDelete,
    BackupManage,
    RoomCreate,
    RoomJoin,
    MessageSend,
}

impl Permission {
    pub fn as_str(&self) -> &'static str {
        match self {
            Permission::Wildcard => "*",
            Permission::UserManage => "user.manage",
            Permission::InviteUnlimited => "invite.unlimited",
            Permission::InviteLimited => "invite.limited",
            Permission::ConfigEdit => "config.edit",
            Permission::RoomForceDelete => "room.force_delete",
            Permission::BackupManage => "backup.manage",
            Permission::RoomCreate => "room.create",
            Permission::RoomJoin => "room.join",
            Permission::MessageSend => "message.send",
        }
    }

    pub fn from_str(s: &str) -> Option<Permission> {
        match s {
            "*" => Some(Permission::Wildcard),
            "user.manage" => Some(Permission::UserManage),
            "invite.unlimited" => Some(Permission::InviteUnlimited),
            "invite.limited" => Some(Permission::InviteLimited),
            "config.edit" => Some(Permission::ConfigEdit),
            "room.force_delete" => Some(Permission::RoomForceDelete),
            "backup.manage" => Some(Permission::BackupManage),
            "room.create" => Some(Permission::RoomCreate),
            "room.join" => Some(Permission::RoomJoin),
            "message.send" => Some(Permission::MessageSend),
            _ => None,
        }
    }
}

impl fmt::Display for Permission {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl Serialize for Permission {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for Permission {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Permission::from_str(&s).ok_or_else(|| serde::de::Error::custom("invalid permission"))
    }
}
