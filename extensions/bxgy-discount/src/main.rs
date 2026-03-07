use std::process;

use shopify_function::prelude::*;
use shopify_function::Result;

use serde::Deserialize;

#[typegen("./schema.graphql")]
mod schema {
    #[query("./src/run.graphql")]
    pub mod run {}
}

use schema::run::run_input::cart::lines::Merchandise;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TierConfig {
    min_quantity: i32,
    max_reward: i32,
    discount_value: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VolumeTierConfig {
    qty: i32,
    discount_pct: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComplementProductConfig {
    product_id: String,
    discount_pct: f64,
    #[serde(default = "default_quantity")]
    quantity: i32,
}

fn default_quantity() -> i32 { 1 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FunctionConfig {
    title: Option<String>,
    bundle_type: Option<String>,
    buy_type: String,
    buy_product_id: Option<String>,
    buy_product_ids: Option<Vec<String>>,
    buy_collection_ids: Option<Vec<String>>,
    min_quantity: i32,
    get_product_id: String,
    get_product_ids: Option<Vec<String>>,
    discount_type: String,
    discount_value: f64,
    max_reward: i32,
    tiers: Option<Vec<TierConfig>>,
    volume_tiers: Option<Vec<VolumeTierConfig>>,
    complement_products: Option<Vec<ComplementProductConfig>>,
    trigger_product_id: Option<String>,
    mode: Option<String>,
    trigger_discount_pct: Option<f64>,
}

/// Check if a cart line's _bxapp_bundle_type attribute matches the discount's bundle_type.
/// Returns true if:
/// - The cart line has no bundle_type attribute (backwards compat: items added without widget)
/// - The cart line's bundle_type matches the config's bundle_type
/// Returns false if:
/// - The cart line has a different bundle_type (e.g. line is "volume" but discount is "tiered")
fn line_matches_bundle_type(
    line: &schema::run::run_input::cart::Lines,
    config_bundle_type: Option<&str>,
) -> bool {
    let line_type = line.bundle_type().and_then(|a| {
        a.value().and_then(|v| {
            if v.is_empty() { None } else { Some(v.as_str()) }
        })
    });
    match (line_type, config_bundle_type) {
        (None, _) => true,                           // no attribute → allow (backwards compat)
        (Some(_), None) => true,                     // no config type → allow (old discounts)
        (Some(lt), Some(ct)) => lt == ct,            // both set → must match
    }
}

#[shopify_function]
fn run(input: schema::run::RunInput) -> Result<schema::FunctionRunResult> {
    let empty = schema::FunctionRunResult {
        discounts: vec![],
        discount_application_strategy: schema::DiscountApplicationStrategy::First,
    };

    // Parse the metafield configuration
    let metafield = match input.discount_node().metafield() {
        Some(m) => m,
        None => return Ok(empty),
    };

    let config: FunctionConfig = match serde_json::from_str(metafield.value()) {
        Ok(c) => c,
        Err(_) => return Ok(empty),
    };

    // ── Complement / FBT path ──
    if let Some(ref complement_products) = config.complement_products {
        // Skip if no complements configured
        if complement_products.is_empty() {
            return Ok(empty);
        }

        // Build a map of complement product_id → (discount_pct, quantity)
        let mut complement_map: std::collections::HashMap<String, (f64, i32)> = std::collections::HashMap::new();
        for cp in complement_products.iter() {
            complement_map.insert(cp.product_id.clone(), (cp.discount_pct, cp.quantity.max(1)));
        }

        // If a specific trigger product is required, check it's in the cart
        if let Some(ref trigger_pid) = config.trigger_product_id {
            if !trigger_pid.is_empty() {
                let trigger_in_cart = input.cart().lines().iter().any(|line| {
                    if let Merchandise::ProductVariant(variant) = line.merchandise() {
                        variant.product().id() == trigger_pid.as_str()
                    } else {
                        false
                    }
                });
                if !trigger_in_cart {
                    return Ok(empty);
                }
            }
        } else {
            // No specific trigger product — gate on buy_type / buy_product_ids
            let buy_all = config.buy_type.as_str() == "all";
            if !buy_all {
                // For collection or product-list triggers, require at least one qualifying product
                let has_trigger = input.cart().lines().iter().any(|line| {
                    if let Merchandise::ProductVariant(variant) = line.merchandise() {
                        let pid = variant.product().id();
                        // Don't count complement products as triggers
                        if complement_map.contains_key(&pid.to_string()) {
                            return false;
                        }
                        if let Some(ref ids) = config.buy_product_ids {
                            ids.iter().any(|id| pid == id.as_str())
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                });
                if !has_trigger {
                    return Ok(empty);
                }
            }
            // buy_type == "all": any product in cart qualifies, no gate needed
        }

        // Determine if combo mode with trigger discount
        let is_combo = config.mode.as_deref() == Some("combo");
        let trigger_pct = config.trigger_discount_pct.unwrap_or(0.0);

        // In combo mode, check if at least one complement product is in the cart
        let has_complement_in_cart = if is_combo {
            input.cart().lines().iter().any(|line| {
                if !line_matches_bundle_type(line, config.bundle_type.as_deref()) {
                    return false;
                }
                if let Merchandise::ProductVariant(variant) = line.merchandise() {
                    complement_map.contains_key(&variant.product().id().to_string())
                } else {
                    false
                }
            })
        } else {
            false
        };

        // Collect complement lines in the cart and group by discount_pct
        // Use the configured quantity as the max units to discount per complement
        let mut groups: std::collections::HashMap<i64, Vec<(String, i32)>> = std::collections::HashMap::new();
        for line in input.cart().lines() {
            if !line_matches_bundle_type(line, config.bundle_type.as_deref()) {
                continue;
            }
            if let Merchandise::ProductVariant(variant) = line.merchandise() {
                let product_id = variant.product().id().to_string();

                // In combo mode, also add trigger product to discount groups
                // (only if at least one complement is also in the cart)
                if is_combo && trigger_pct > 0.0 && has_complement_in_cart {
                    if let Some(ref trigger_pid) = config.trigger_product_id {
                        if !trigger_pid.is_empty() && product_id == *trigger_pid {
                            let key = (trigger_pct * 100.0) as i64;
                            groups
                                .entry(key)
                                .or_insert_with(Vec::new)
                                .push((variant.id().to_string(), *line.quantity()));
                        }
                    }
                }

                if let Some(&(pct, expected_qty)) = complement_map.get(&product_id) {
                    if pct <= 0.0 {
                        continue; // No discount for this complement
                    }
                    // Cap discount to the configured quantity
                    let discount_qty = std::cmp::min(*line.quantity(), expected_qty);
                    // Use i64 key (pct * 100) to group by discount percentage
                    let key = (pct * 100.0) as i64;
                    groups
                        .entry(key)
                        .or_insert_with(Vec::new)
                        .push((variant.id().to_string(), discount_qty));
                }
            }
        }

        if groups.is_empty() {
            return Ok(empty);
        }

        // Build one Discount per unique discount_pct group
        let mut discounts: Vec<schema::Discount> = Vec::new();
        for (pct_key, lines) in groups.iter() {
            let pct = *pct_key as f64 / 100.0;
            let mut targets: Vec<schema::Target> = Vec::new();
            for (variant_id, qty) in lines {
                targets.push(schema::Target::ProductVariant(schema::ProductVariantTarget {
                    id: variant_id.clone(),
                    quantity: Some(*qty),
                }));
            }
            let msg = config.title.clone().unwrap_or_else(|| {
                if is_combo {
                    format!("Combo {}% off", pct)
                } else {
                    format!("FBT {}% off", pct)
                }
            });
            discounts.push(schema::Discount {
                message: Some(msg),
                targets,
                value: schema::Value::Percentage(schema::Percentage {
                    value: shopify_function::scalars::Decimal(pct),
                }),
            });
        }

        return Ok(schema::FunctionRunResult {
            discounts,
            discount_application_strategy: schema::DiscountApplicationStrategy::All,
        });
    }

    // ── Volume Discount path ──
    // If volume_tiers is present, apply percentage discount to ALL units of the product.
    if let Some(ref volume_tiers) = config.volume_tiers {
        // Find matching product lines
        let mut product_lines: Vec<(String, i32)> = Vec::new(); // (variant_id, qty)
        let mut total_qty: i32 = 0;

        // Determine if buyType is "all" (match any product)
        let buy_all = config.buy_type.as_str() == "all";

        for line in input.cart().lines() {
            if !line_matches_bundle_type(line, config.bundle_type.as_deref()) {
                continue;
            }
            if let Merchandise::ProductVariant(variant) = line.merchandise() {
                let product_id = variant.product().id();
                let matches = if buy_all {
                    true
                } else if let Some(ref ids) = config.buy_product_ids {
                    ids.iter().any(|id| product_id == id.as_str())
                } else if let Some(ref buy_pid) = config.buy_product_id {
                    product_id == buy_pid.as_str()
                } else {
                    product_id == config.get_product_id.as_str()
                };
                if matches {
                    total_qty += *line.quantity();
                    product_lines.push((variant.id().to_string(), *line.quantity()));
                }
            }
        }

        // Find best qualifying volume tier
        let mut best_tier: Option<&VolumeTierConfig> = None;
        for tier in volume_tiers.iter() {
            if total_qty >= tier.qty {
                match best_tier {
                    Some(current) => {
                        if tier.qty > current.qty {
                            best_tier = Some(tier);
                        }
                    }
                    None => {
                        best_tier = Some(tier);
                    }
                }
            }
        }

        let tier = match best_tier {
            Some(t) => t,
            None => return Ok(empty),
        };

        // If discount is 0 (e.g. "Single" tier), no discount to apply
        if tier.discount_pct <= 0.0 {
            return Ok(empty);
        }

        if product_lines.is_empty() {
            return Ok(empty);
        }

        // Build targets: discount ALL units (no quantity cap)
        let mut targets: Vec<schema::Target> = Vec::new();
        for (variant_id, line_qty) in &product_lines {
            targets.push(schema::Target::ProductVariant(schema::ProductVariantTarget {
                id: variant_id.clone(),
                quantity: Some(*line_qty),
            }));
        }

        let discount = schema::Discount {
            message: Some(config.title.clone().unwrap_or_else(|| "Volume Discount".to_string())),
            targets,
            value: schema::Value::Percentage(schema::Percentage {
                value: shopify_function::scalars::Decimal(tier.discount_pct),
            }),
        };

        return Ok(schema::FunctionRunResult {
            discounts: vec![discount],
            discount_application_strategy: schema::DiscountApplicationStrategy::First,
        });
    }

    // ── Classic BXGY / Tiered Combo path ──

    // Count "buy" items in the cart and find "get" targets
    let mut buy_quantity: i32 = 0;
    let mut get_targets: Vec<(String, i32)> = Vec::new();

    for line in input.cart().lines() {
        if !line_matches_bundle_type(line, config.bundle_type.as_deref()) {
            continue;
        }
        if let Merchandise::ProductVariant(variant) = line.merchandise() {
            let product_id = variant.product().id();

            // Check if this line matches "buy" criteria
            let is_buy = match config.buy_type.as_str() {
                "all" => true,
                "product" => {
                    // Check against buy_product_ids first, fallback to buy_product_id
                    if let Some(ref ids) = config.buy_product_ids {
                        ids.iter().any(|id| id.as_str() == product_id)
                    } else if let Some(ref buy_pid) = config.buy_product_id {
                        product_id == buy_pid.as_str()
                    } else {
                        false
                    }
                }
                "collection" => {
                    // For collection type, buy_product_ids contains resolved product IDs
                    if let Some(ref ids) = config.buy_product_ids {
                        ids.iter().any(|id| id.as_str() == product_id)
                    } else if let Some(ref ids) = config.buy_collection_ids {
                        ids.iter().any(|id| id.as_str() == product_id)
                    } else {
                        false
                    }
                }
                _ => false,
            };

            if is_buy {
                buy_quantity += *line.quantity();
            }

            // Check if this line is a "get" (reward) product
            // For multi-product / all / collection: the get product is the same as buy
            let is_get = if let Some(ref ids) = config.get_product_ids {
                ids.iter().any(|id| id.as_str() == product_id)
            } else {
                product_id == config.get_product_id.as_str()
            };
            // For "all" type, every product is also a get target
            let is_get = is_get || config.buy_type.as_str() == "all";

            if is_get {
                get_targets.push((variant.id().to_string(), *line.quantity()));
            }
        }
    }

    // Detect if buy and get are the same product(s)
    let same_product = match config.buy_type.as_str() {
        "all" => true,
        "product" => {
            if let Some(ref ids) = config.get_product_ids {
                if let Some(ref buy_ids) = config.buy_product_ids {
                    buy_ids.iter().all(|b| ids.contains(b))
                } else if let Some(ref buy_pid) = config.buy_product_id {
                    ids.contains(buy_pid)
                } else {
                    false
                }
            } else {
                match config.buy_product_id {
                    Some(ref buy_pid) => buy_pid == &config.get_product_id,
                    None => false,
                }
            }
        }
        "collection" => true,
        _ => false,
    };

    // Determine which tier applies (if tiers are configured)
    let (effective_min_qty, effective_max_reward, effective_discount_value) =
        if let Some(ref tiers) = config.tiers {
            // Find the best tier the customer qualifies for
            let mut best_tier: Option<&TierConfig> = None;
            for tier in tiers.iter() {
                // When buy=get=same product, customer needs buyQty + freeQty total items
                // to qualify for a tier (e.g. "buy 2 get 3 free" needs 5 items).
                // When they're different products, only the buy quantity matters.
                let qualifies = if same_product {
                    buy_quantity >= tier.min_quantity + tier.max_reward
                } else {
                    buy_quantity >= tier.min_quantity
                };

                if qualifies {
                    match best_tier {
                        Some(current) => {
                            if tier.min_quantity > current.min_quantity {
                                best_tier = Some(tier);
                            }
                        }
                        None => {
                            best_tier = Some(tier);
                        }
                    }
                }
            }
            match best_tier {
                Some(tier) => (tier.min_quantity, tier.max_reward, tier.discount_value),
                None => return Ok(empty), // no tier qualifies
            }
        } else {
            // Non-tiered: same logic applies
            let qualifies = if same_product {
                buy_quantity >= config.min_quantity + config.max_reward
            } else {
                buy_quantity >= config.min_quantity
            };
            if !qualifies {
                return Ok(empty);
            }
            (config.min_quantity, config.max_reward, config.discount_value)
        };

    // Check we have reward targets
    if get_targets.is_empty() {
        return Ok(empty);
    }

    // Build targets with capped reward quantity.
    // When buy=get=same product, never discount more than (total - buyQty) items
    // so the "buy" portion is always charged at full price.
    let max_discountable = if same_product {
        std::cmp::min(effective_max_reward, buy_quantity - effective_min_qty)
    } else {
        effective_max_reward
    };
    let mut remaining_reward = max_discountable;
    let mut targets: Vec<schema::Target> = Vec::new();

    for (variant_id, line_qty) in &get_targets {
        if remaining_reward <= 0 {
            break;
        }
        let reward_qty = std::cmp::min(*line_qty, remaining_reward);
        targets.push(schema::Target::ProductVariant(schema::ProductVariantTarget {
            id: variant_id.clone(),
            quantity: Some(reward_qty),
        }));
        remaining_reward -= reward_qty;
    }

    if targets.is_empty() {
        return Ok(empty);
    }

    // Build the discount value
    let value = match config.discount_type.as_str() {
        "percentage" => schema::Value::Percentage(schema::Percentage {
            value: shopify_function::scalars::Decimal(effective_discount_value),
        }),
        "fixed" => schema::Value::FixedAmount(schema::FixedAmount {
            amount: shopify_function::scalars::Decimal(effective_discount_value),
            applies_to_each_item: None,
        }),
        _ => return Ok(empty),
    };

    let discount = schema::Discount {
        message: Some(config.title.clone().unwrap_or_else(|| "BXGY Bundle Discount".to_string())),
        targets,
        value,
    };

    Ok(schema::FunctionRunResult {
        discounts: vec![discount],
        discount_application_strategy: schema::DiscountApplicationStrategy::First,
    })
}

fn main() {
    process::abort();
}
