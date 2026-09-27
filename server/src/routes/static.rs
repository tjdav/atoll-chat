use tower_http::services::{ServeDir, ServeFile};

pub fn build_spa_service(dir: &str) -> ServeDir<ServeFile> {
    let index = format!("{}/index.html", dir);
    ServeDir::new(dir).fallback(ServeFile::new(index))
}
