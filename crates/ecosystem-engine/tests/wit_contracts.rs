use std::fs;
use std::path::PathBuf;
use wit_parser::WorldItem;

#[test]
fn canonical_wit_worlds_parse_and_resolve() {
    let contracts = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendored/wit");
    let mut worlds = fs::read_dir(&contracts)
        .expect("read WIT contract directory")
        .filter_map(Result::ok)
        .filter(|entry| entry.path().join("world.wit").is_file())
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    worlds.sort();

    assert_eq!(
        worlds.len(),
        9,
        "locked and candidate WIT inventory changed"
    );
    for path in worlds {
        let directory = path
            .file_name()
            .and_then(|name| name.to_str())
            .expect("WIT directory name");
        let mut resolve = wit_parser::Resolve::default();
        let (package_id, _) = resolve
            .push_dir(&path)
            .unwrap_or_else(|error| panic!("{}: {error:#}", path.display()));
        if matches!(
            directory,
            "boussole-scoring-v2" | "notebook-core-v2" | "policy-core-v2" | "radar-engine-v2"
        ) {
            let package = &resolve.packages[package_id];
            assert_eq!(package.worlds.len(), 1, "{directory}: world count");
            let world_id = *package.worlds.values().next().expect("resolved WIT world");
            let world = &resolve.worlds[world_id];
            assert!(
                world.imports.is_empty(),
                "{directory}: capability-free world resolves imports: {:?}",
                world.imports.keys().collect::<Vec<_>>()
            );
            assert_eq!(world.exports.len(), 1, "{directory}: exported API count");
            if directory == "radar-engine-v2" {
                let interface_id = match world.exports.values().next() {
                    Some(WorldItem::Interface { id, .. }) => *id,
                    other => panic!("{directory}: expected one exported interface, got {other:?}"),
                };
                let functions = resolve.interfaces[interface_id]
                    .functions
                    .keys()
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                assert_eq!(functions, ["parse-feed", "evaluate-rules"]);
            }
        }
    }
}
