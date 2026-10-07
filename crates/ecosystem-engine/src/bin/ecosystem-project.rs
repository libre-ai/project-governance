use libre_ai_ecosystem_engine::{GraphPolicy, KnowledgeGraph, SourceDocument};
use std::env;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

fn main() -> Result<(), Box<dyn Error>> {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    let objects = argument(&arguments, "--objects")?;
    let output = argument(&arguments, "--output")?;
    let check = arguments.iter().any(|argument| argument == "--check");

    let mut paths = Vec::new();
    collect_json_files(Path::new(objects), &mut paths)?;
    paths.sort();
    let sources = paths
        .iter()
        .map(|path| Ok(SourceDocument::new(path.to_string_lossy(), fs::read(path)?)))
        .collect::<Result<Vec<_>, std::io::Error>>()?;
    let graph = KnowledgeGraph::ingest(sources, &GraphPolicy::canonical())?;
    let projection = graph.public_projection_bytes()?;
    let output_path = Path::new(output);

    if check {
        let current = fs::read(output_path)?;
        if current != projection {
            return Err(format!("knowledge projection differs: {}", output_path.display()).into());
        }
    } else {
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(output_path, projection)?;
    }
    Ok(())
}

fn argument<'a>(arguments: &'a [String], name: &str) -> Result<&'a str, Box<dyn Error>> {
    arguments
        .windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].as_str())
        .ok_or_else(|| format!("missing required argument {name}").into())
}

fn collect_json_files(directory: &Path, output: &mut Vec<PathBuf>) -> Result<(), std::io::Error> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            collect_json_files(&entry.path(), output)?;
        } else if file_type.is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "json")
        {
            output.push(entry.path());
        }
    }
    Ok(())
}
