use agent_client_protocol as acp;
use emergent_protocol::{
    ConfigChangeEntry, ConfigOption, ConfigSelectGroup, ConfigSelectOption, ConfigSelectOptions,
};

/// Convert ACP SessionConfigOption list to our protocol types.
pub fn convert_config_options(acp_options: &[acp::SessionConfigOption]) -> Vec<ConfigOption> {
    acp_options.iter().filter_map(convert_one).collect()
}

fn convert_one(opt: &acp::SessionConfigOption) -> Option<ConfigOption> {
    let acp::SessionConfigKind::Select(select) = &opt.kind else {
        return None; // Only select options supported
    };

    let category = opt.category.as_ref().map(|c| match c {
        acp::SessionConfigOptionCategory::Model => "model".to_string(),
        acp::SessionConfigOptionCategory::ThoughtLevel => "thought_level".to_string(),
        acp::SessionConfigOptionCategory::Mode => "mode".to_string(),
        acp::SessionConfigOptionCategory::Other(s) => s.clone(),
        _ => "other".to_string(),
    });

    let options = match &select.options {
        acp::SessionConfigSelectOptions::Ungrouped(opts) => ConfigSelectOptions::Ungrouped(
            opts.iter()
                .map(|o| ConfigSelectOption {
                    value: o.value.to_string(),
                    name: o.name.clone(),
                })
                .collect(),
        ),
        acp::SessionConfigSelectOptions::Grouped(groups) => ConfigSelectOptions::Grouped(
            groups
                .iter()
                .map(|g| ConfigSelectGroup {
                    label: g.name.clone(),
                    options: g
                        .options
                        .iter()
                        .map(|o| ConfigSelectOption {
                            value: o.value.to_string(),
                            name: o.name.clone(),
                        })
                        .collect(),
                })
                .collect(),
        ),
        _ => return None, // Unknown options variant
    };

    Some(ConfigOption {
        id: opt.id.to_string(),
        name: opt.name.clone(),
        description: opt.description.clone(),
        category,
        current_value: select.current_value.to_string(),
        options,
    })
}

/// Diff two config states, returning human-readable change entries.
pub fn diff_config(old: &[ConfigOption], new: &[ConfigOption]) -> Vec<ConfigChangeEntry> {
    let mut changes = Vec::new();
    for new_opt in new {
        let old_opt = old.iter().find(|o| o.id == new_opt.id);
        let changed = match old_opt {
            Some(o) => o.current_value != new_opt.current_value,
            None => true, // new option appeared
        };
        if changed {
            let value_name = find_value_name(&new_opt.options, &new_opt.current_value)
                .unwrap_or_else(|| new_opt.current_value.clone());
            changes.push(ConfigChangeEntry {
                option_name: new_opt.name.clone(),
                new_value_name: value_name,
            });
        }
    }
    changes
}

fn find_value_name(options: &ConfigSelectOptions, value: &str) -> Option<String> {
    match options {
        ConfigSelectOptions::Ungrouped(opts) => opts
            .iter()
            .find(|o| o.value == value)
            .map(|o| o.name.clone()),
        ConfigSelectOptions::Grouped(groups) => groups
            .iter()
            .flat_map(|g| &g.options)
            .find(|o| o.value == value)
            .map(|o| o.name.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_config(id: &str, name: &str, current: &str, values: &[(&str, &str)]) -> ConfigOption {
        ConfigOption {
            id: id.into(),
            name: name.into(),
            description: None,
            category: None,
            current_value: current.into(),
            options: ConfigSelectOptions::Ungrouped(
                values
                    .iter()
                    .map(|(v, n)| ConfigSelectOption {
                        value: v.to_string(),
                        name: n.to_string(),
                    })
                    .collect(),
            ),
        }
    }

    #[test]
    fn diff_detects_value_change() {
        let old = vec![make_config(
            "model",
            "Model",
            "opus-4",
            &[("opus-4", "Opus 4"), ("sonnet-4", "Sonnet 4")],
        )];
        let new = vec![make_config(
            "model",
            "Model",
            "sonnet-4",
            &[("opus-4", "Opus 4"), ("sonnet-4", "Sonnet 4")],
        )];
        let changes = diff_config(&old, &new);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].option_name, "Model");
        assert_eq!(changes[0].new_value_name, "Sonnet 4");
    }

    #[test]
    fn diff_no_changes() {
        let opts = vec![make_config(
            "model",
            "Model",
            "opus-4",
            &[("opus-4", "Opus 4")],
        )];
        let changes = diff_config(&opts, &opts);
        assert!(changes.is_empty());
    }

    #[test]
    fn diff_multiple_changes() {
        let old = vec![
            make_config(
                "model",
                "Model",
                "opus-4",
                &[("opus-4", "Opus 4"), ("haiku", "Haiku 3.5")],
            ),
            make_config(
                "thinking",
                "Thinking",
                "high",
                &[("off", "Off"), ("high", "High")],
            ),
        ];
        let new = vec![
            make_config(
                "model",
                "Model",
                "haiku",
                &[("opus-4", "Opus 4"), ("haiku", "Haiku 3.5")],
            ),
            make_config(
                "thinking",
                "Thinking",
                "off",
                &[("off", "Off"), ("high", "High")],
            ),
        ];
        let changes = diff_config(&old, &new);
        assert_eq!(changes.len(), 2);
    }
}
