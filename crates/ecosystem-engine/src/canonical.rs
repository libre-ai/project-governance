use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::fmt::Write;

pub fn canonical_json(value: &Value) -> Result<Vec<u8>, serde_json::Error> {
    let mut output = Vec::new();
    write_canonical(value, &mut output)?;
    Ok(output)
}

pub fn stable_pretty_json(value: &Value) -> Result<Vec<u8>, serde_json::Error> {
    let sorted = sorted_value(value);
    let mut output = serde_json::to_vec_pretty(&sorted)?;
    output.push(b'\n');
    Ok(output)
}

pub fn sha256_hex(value: &[u8]) -> String {
    let digest = Sha256::digest(value);
    let mut encoded = String::with_capacity(64);
    for byte in digest {
        write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    encoded
}

fn write_canonical(value: &Value, output: &mut Vec<u8>) -> Result<(), serde_json::Error> {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            serde_json::to_writer(output, value)?;
        }
        Value::Array(values) => {
            output.push(b'[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                write_canonical(value, output)?;
            }
            output.push(b']');
        }
        Value::Object(object) => {
            output.push(b'{');
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                serde_json::to_writer(&mut *output, key)?;
                output.push(b':');
                write_canonical(&object[key], output)?;
            }
            output.push(b'}');
        }
    }
    Ok(())
}

fn sorted_value(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(sorted_value).collect()),
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            let mut sorted = Map::new();
            for key in keys {
                sorted.insert(key.clone(), sorted_value(&object[key]));
            }
            Value::Object(sorted)
        }
        _ => value.clone(),
    }
}
