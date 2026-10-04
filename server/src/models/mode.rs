use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelHostingMode {
    Local,
    External,
    Proxy,
}

impl ModelHostingMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ModelHostingMode::Local => "local",
            ModelHostingMode::External => "external",
            ModelHostingMode::Proxy => "proxy",
        }
    }

    pub fn registers_routes(&self) -> bool {
        match self {
            ModelHostingMode::Local | ModelHostingMode::Proxy => true,
            ModelHostingMode::External => false,
        }
    }
}

impl FromStr for ModelHostingMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_lowercase().as_str() {
            "local" => Ok(ModelHostingMode::Local),
            "external" => Ok(ModelHostingMode::External),
            "proxy" => Ok(ModelHostingMode::Proxy),
            other => Err(format!("Invalid MODEL_HOSTING_MODE '{}'", other)),
        }
    }
}

impl fmt::Display for ModelHostingMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}
