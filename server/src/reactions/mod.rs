pub mod list;
pub mod write;

pub const MAX_REACTION_LENGTH: usize = 64;
pub const MAX_REACTION_BYTES: usize = 256;

#[derive(Debug, thiserror::Error)]
pub enum ReactionError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("message not found")]
    MessageNotFound,
    #[error("not a member")]
    NotAMember,
    #[error("reaction already exists")]
    AlreadyExists,
    #[error("reaction not found")]
    NotFound,
    #[error("invalid reaction: {0}")]
    InvalidReaction(String),
    #[error("reaction limit reached for this message")]
    LimitReached,
}
