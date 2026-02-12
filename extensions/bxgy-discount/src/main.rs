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
struct FunctionConfig {
    buy_type: String,
    buy_product_id: Option<String>,
    buy_collection_ids: Option<Vec<String>>,
    min_quantity: i32,
    get_product_id: String,
    discount_type: String,
    discount_value: f64,
    max_reward: i32,
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
    let mut get_targets: Vec<schema::Target> = Vec::new();
    let mut found_get = false;

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
                let reward_qty = std::cmp::min(*line.quantity(), config.max_reward);
                if reward_qty > 0 {
                    get_targets.push(schema::Target::ProductVariant(schema::ProductVariantTarget {
                        id: variant.id().to_string(),
                        quantity: Some(reward_qty),
                    }));
                    found_get = true;
                }
            }
        }
    }

    // Check if minimum buy quantity is met and we have reward targets
    if buy_quantity < config.min_quantity || !found_get {
        return Ok(empty);
    }

    // Build the discount value
    let value = match config.discount_type.as_str() {
        "percentage" => schema::Value::Percentage(schema::Percentage {
            value: shopify_function::scalars::Decimal(config.discount_value),
        }),
        "fixed" => schema::Value::FixedAmount(schema::FixedAmount {
            amount: shopify_function::scalars::Decimal(config.discount_value),
            applies_to_each_item: None,
        }),
        _ => return Ok(empty),
    };

    let discount = schema::Discount {
        message: Some("BXGY Bundle Discount".to_string()),
        targets: get_targets,
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
