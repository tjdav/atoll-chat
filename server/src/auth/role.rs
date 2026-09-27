use crate::auth::permission::Permission;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    Owner,
    Admin,
    Inviter,
    Member,
}

impl Role {
    pub fn as_str(&self) -> &'static str {
        match self {
            Role::Owner => "owner",
            Role::Admin => "admin",
            Role::Inviter => "inviter",
            Role::Member => "member",
        }
    }

    #[allow(dead_code)]
    pub fn from_str(s: &str) -> Option<Role> {
        match s {
            "owner" => Some(Role::Owner),
            "admin" => Some(Role::Admin),
            "inviter" => Some(Role::Inviter),
            "member" => Some(Role::Member),
            _ => None,
        }
    }

    pub fn level(&self) -> u8 {
        match self {
            Role::Owner => 100,
            Role::Admin => 80,
            Role::Inviter => 50,
            Role::Member => 10,
        }
    }

    pub fn permissions(&self) -> &'static [Permission] {
        match self {
            Role::Owner => &[Permission::Wildcard],
            Role::Admin => &[
                Permission::UserManage,
                Permission::InviteUnlimited,
                Permission::ConfigEdit,
                Permission::RoomForceDelete,
                Permission::BackupManage,
            ],
            Role::Inviter => &[Permission::InviteLimited],
            Role::Member => &[
                Permission::RoomCreate,
                Permission::RoomJoin,
                Permission::MessageSend,
            ],
        }
    }

    pub fn all() -> &'static [Role] {
        &[Role::Owner, Role::Admin, Role::Inviter, Role::Member]
    }
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}
