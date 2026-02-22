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
struct FunctionConfig {
    buy_type: String,
    buy_product_id: Option<String>,
    buy_collection_ids: Option<Vec<String>>,
    min_quantity: i32,
    get_product_id: String,
    discount_type: String,
    discount_value: f64,
    max_reward: i32,
    tiers: Option<Vec<TierConfig>>,
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

    // Count "buy" items in the cart and find "get" targets
    let mut buy_quantity: i32 = 0;
    let mut get_targets: Vec<(String, i32)> = Vec::new();

    for line in input.cart().lines() {
        if let Merchandise::ProductVariant(variant) = line.merchandise() {
            let product_id = variant.product().id();

            // Check if this line matches "buy" criteria
            let is_buy = match config.buy_type.as_str() {
                "product" => {
                    if let Some(ref buy_pid) = config.buy_product_id {
                        product_id == buy_pid.as_str()
                    } else {
                        false
                    }
                }
                "collection" => {
                    if let Some(ref ids) = config.buy_collection_ids {
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

            // Check if this line is the "get" (reward) product
            if product_id == config.get_product_id.as_str() {
                get_targets.push((variant.id().to_string(), *line.quantity()));
            }
        }
    }

    // Detect if buy and get are the same product (tiered combo scenario)
    let same_product = match config.buy_product_id {
        Some(ref buy_pid) => buy_pid == &config.get_product_id,
        None => false,
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
        message: Some("BXGY Bundle Discount".to_string()),
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
