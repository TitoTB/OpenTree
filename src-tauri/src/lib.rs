#[tauri::command]
async fn fetch_ine_json(path: String) -> Result<serde_json::Value, String> {
    let allowed_path = path.starts_with("/apellidos/widget?")
        || path.starts_with("/apellidos/mapaWidget?");

    if !allowed_path {
        return Err("Ruta del INE no permitida".to_string());
    }

    let url = format!("https://www.ine.es{path}");
    let response = reqwest::Client::new()
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "OpenTree/0.1 local genealogy app",
        )
        .send()
        .await
        .map_err(|error| format!("No se ha podido consultar el INE: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("El INE ha devuelto HTTP {}", response.status()));
    }

    response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Respuesta del INE no válida: {error}"))
}

#[tauri::command]
async fn fetch_forebears_html(path: String) -> Result<String, String> {
    if !path.starts_with("/surnames/") {
        return Err("Ruta de Forebears no permitida".to_string());
    }

    let url = format!("https://forebears.io{path}");
    let response = reqwest::Client::new()
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 OpenTree/0.1 local genealogy app",
        )
        .send()
        .await
        .map_err(|error| format!("No se ha podido consultar Forebears: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Forebears ha devuelto HTTP {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|error| format!("Respuesta de Forebears no vÃ¡lida: {error}"))
}

#[tauri::command]
async fn fetch_behind_the_name_html(path: String) -> Result<String, String> {
    if !path.starts_with("/name/") {
        return Err("Ruta de Behind the Name no permitida".to_string());
    }

    let url = format!("https://www.behindthename.com{path}");
    let response = reqwest::Client::new()
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 OpenTree/0.1 local genealogy app",
        )
        .send()
        .await
        .map_err(|error| format!("No se ha podido consultar Behind the Name: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Behind the Name ha devuelto HTTP {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|error| format!("Respuesta de Behind the Name no valida: {error}"))
}

#[tauri::command]
async fn fetch_geneanet_html(path: String) -> Result<String, String> {
    if !path.starts_with("/apellidos/") {
        return Err("Ruta de Geneanet no permitida".to_string());
    }

    let url = format!("https://es.geneanet.org{path}");
    let response = reqwest::Client::new()
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 OpenTree/0.1 local genealogy app",
        )
        .send()
        .await
        .map_err(|error| format!("No se ha podido consultar Geneanet: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Geneanet ha devuelto HTTP {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|error| format!("Respuesta de Geneanet no valida: {error}"))
}

#[tauri::command]
async fn fetch_translation_json(path: String) -> Result<serde_json::Value, String> {
    if !path.starts_with("/get?") {
        return Err("Ruta de traduccion no permitida".to_string());
    }

    let url = format!("https://api.mymemory.translated.net{path}");
    let response = reqwest::Client::new()
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "OpenTree/0.1 local genealogy app",
        )
        .send()
        .await
        .map_err(|error| format!("No se ha podido traducir el texto: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("El traductor ha devuelto HTTP {}", response.status()));
    }

    response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Respuesta del traductor no valida: {error}"))
}

#[tauri::command]
async fn fetch_medlineplus_xml(path: String) -> Result<String, String> {
    if !path.starts_with("/ws/query?") {
        return Err("Ruta de MedlinePlus no permitida".to_string());
    }

    let url = format!("https://wsearch.nlm.nih.gov{path}");
    let response = reqwest::Client::new()
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "OpenTree/0.1 local genealogy app",
        )
        .send()
        .await
        .map_err(|error| format!("No se ha podido consultar MedlinePlus: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("MedlinePlus ha devuelto HTTP {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|error| format!("Respuesta de MedlinePlus no valida: {error}"))
}

#[tauri::command]
async fn fetch_mayo_clinic_html(path: String) -> Result<String, String> {
    if !path.starts_with("/es/diseases-conditions/") {
        return Err("Ruta de Mayo Clinic no permitida".to_string());
    }

    let url = format!("https://www.mayoclinic.org{path}");
    let response = reqwest::Client::new()
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 OpenTree/0.1 local genealogy app",
        )
        .send()
        .await
        .map_err(|error| format!("No se ha podido consultar Mayo Clinic: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Mayo Clinic ha devuelto HTTP {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|error| format!("Respuesta de Mayo Clinic no valida: {error}"))
}

#[tauri::command]
async fn fetch_public_search_html(query: String) -> Result<String, String> {
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() || trimmed_query.len() > 180 {
        return Err("Consulta publica no permitida".to_string());
    }

    let response = reqwest::Client::new()
        .get("https://duckduckgo.com/html/")
        .query(&[("q", trimmed_query)])
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 OpenTree/0.1 local genealogy app",
        )
        .send()
        .await
        .map_err(|error| format!("No se ha podido realizar la busqueda publica: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "La busqueda publica ha devuelto HTTP {}",
            response.status()
        ));
    }

    response
        .text()
        .await
        .map_err(|error| format!("Respuesta de busqueda publica no valida: {error}"))
}

#[tauri::command]
async fn fetch_public_page_html(url: String) -> Result<String, String> {
    let trimmed_url = url.trim();
    if trimmed_url.len() > 2048
        || !(trimmed_url.starts_with("https://") || trimmed_url.starts_with("http://"))
    {
        return Err("URL publica no permitida".to_string());
    }

    let response = reqwest::Client::new()
        .get(trimmed_url)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 OpenTree/0.1 local genealogy app",
        )
        .send()
        .await
        .map_err(|error| format!("No se ha podido abrir la pagina publica: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "La pagina publica ha devuelto HTTP {}",
            response.status()
        ));
    }

    response
        .text()
        .await
        .map_err(|error| format!("Respuesta de pagina publica no valida: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            fetch_ine_json,
            fetch_forebears_html,
            fetch_geneanet_html,
            fetch_behind_the_name_html,
            fetch_translation_json,
            fetch_medlineplus_xml,
            fetch_mayo_clinic_html,
            fetch_public_search_html,
            fetch_public_page_html
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenTree");
}
