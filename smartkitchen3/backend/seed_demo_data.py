"""Load a small, fictional Smart Kitchen dataset for portfolio demonstrations."""

from datetime import datetime, timedelta, timezone
import os

from pymongo import MongoClient
from werkzeug.security import generate_password_hash


MONGO_URI = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017/")
DATABASE_NAME = "SmartKitchenDB"
HOUSEHOLD_ID = "DEMO001"


RECIPES = [
    {
        "id": 900001,
        "name": "Tomato and Cheese Pasta",
        "description": "A quick pasta using tomatoes, cheese and pantry staples.",
        "minutes": 25,
        "n_steps": 5,
        "ingredients": ["pasta", "tomato", "cheese", "onion"],
        "quantity": [250.0, 220.0, 100.0, 80.0],
        "steps": ["Boil the pasta.", "Chop the vegetables.", "Cook the sauce.", "Combine.", "Add cheese."],
        "tags": ["italian", "easy", "main-dish"],
    },
    {
        "id": 900002,
        "name": "Chicken and Rice Bowl",
        "description": "A balanced bowl with chicken, rice and vegetables.",
        "minutes": 35,
        "n_steps": 7,
        "ingredients": ["chicken", "rice", "onion", "tomato"],
        "quantity": [250.0, 200.0, 80.0, 150.0],
        "steps": ["Cook the rice.", "Slice the chicken.", "Chop vegetables.", "Cook chicken.", "Add vegetables.", "Season.", "Serve over rice."],
        "tags": ["high-protein", "medium", "main-dish"],
    },
    {
        "id": 900003,
        "name": "Vegetable Omelette",
        "description": "A fast omelette for breakfast or a light dinner.",
        "minutes": 15,
        "n_steps": 4,
        "ingredients": ["egg", "tomato", "onion", "cheese"],
        "quantity": [150.0, 100.0, 40.0, 40.0],
        "steps": ["Beat the eggs.", "Chop vegetables.", "Cook vegetables.", "Add eggs and cheese."],
        "tags": ["breakfast", "easy", "vegetarian"],
    },
    {
        "id": 900004,
        "name": "Banana Milk Smoothie",
        "description": "A simple smoothie made from ripe banana and milk.",
        "minutes": 5,
        "n_steps": 2,
        "ingredients": ["banana", "milk"],
        "quantity": [150.0, 250.0],
        "steps": ["Add ingredients to a blender.", "Blend until smooth."],
        "tags": ["breakfast", "easy", "drink", "vegetarian"],
    },
    {
        "id": 900005,
        "name": "Tomato Rice Soup",
        "description": "A warm soup that uses tomatoes, rice and onion.",
        "minutes": 40,
        "n_steps": 6,
        "ingredients": ["tomato", "rice", "onion"],
        "quantity": [300.0, 120.0, 80.0],
        "steps": ["Chop vegetables.", "Cook onion.", "Add tomato.", "Add water and rice.", "Simmer.", "Season and serve."],
        "tags": ["soup", "medium", "vegan"],
    },
    {
        "id": 900006,
        "name": "Cheese Toast",
        "description": "A quick toasted sandwich with cheese and tomato.",
        "minutes": 10,
        "n_steps": 3,
        "ingredients": ["bread", "cheese", "tomato"],
        "quantity": [100.0, 70.0, 60.0],
        "steps": ["Assemble the sandwich.", "Toast until golden.", "Serve warm."],
        "tags": ["snack", "easy", "vegetarian"],
    },
    {
        "id": 900007,
        "name": "Egg Fried Rice",
        "description": "A fast meal using cooked rice, egg and onion.",
        "minutes": 20,
        "n_steps": 5,
        "ingredients": ["rice", "egg", "onion"],
        "quantity": [220.0, 100.0, 60.0],
        "steps": ["Chop onion.", "Cook onion.", "Add egg.", "Add rice.", "Season and serve."],
        "tags": ["asian", "easy", "main-dish"],
    },
    {
        "id": 900008,
        "name": "Chicken Tomato Pasta",
        "description": "Pasta with chicken and a fresh tomato sauce.",
        "minutes": 40,
        "n_steps": 8,
        "ingredients": ["pasta", "chicken", "tomato", "onion"],
        "quantity": [250.0, 220.0, 250.0, 80.0],
        "steps": ["Boil pasta.", "Cut chicken.", "Chop vegetables.", "Cook chicken.", "Cook onion.", "Add tomato.", "Combine.", "Serve."],
        "tags": ["italian", "medium", "high-protein"],
    },
    {
        "id": 900009,
        "name": "Banana French Toast",
        "description": "Sweet toast with banana, milk and egg.",
        "minutes": 20,
        "n_steps": 5,
        "ingredients": ["bread", "banana", "milk", "egg"],
        "quantity": [120.0, 120.0, 100.0, 50.0],
        "steps": ["Whisk milk and egg.", "Dip bread.", "Cook both sides.", "Slice banana.", "Serve together."],
        "tags": ["breakfast", "easy", "vegetarian"],
    },
    {
        "id": 900010,
        "name": "Simple Chicken Omelette",
        "description": "A protein-rich omelette with cooked chicken.",
        "minutes": 20,
        "n_steps": 5,
        "ingredients": ["egg", "chicken", "onion"],
        "quantity": [150.0, 120.0, 40.0],
        "steps": ["Slice chicken.", "Chop onion.", "Cook fillings.", "Add beaten eggs.", "Fold and serve."],
        "tags": ["breakfast", "easy", "high-protein"],
    },
    {
        "id": 900011,
        "name": "Creamy Tomato Rice",
        "description": "Comforting rice with tomato, milk and cheese.",
        "minutes": 30,
        "n_steps": 6,
        "ingredients": ["rice", "tomato", "milk", "cheese"],
        "quantity": [200.0, 180.0, 120.0, 60.0],
        "steps": ["Cook rice.", "Chop tomato.", "Cook tomato.", "Add milk.", "Add rice.", "Finish with cheese."],
        "tags": ["comfort-food", "medium", "vegetarian"],
    },
    {
        "id": 900012,
        "name": "Fresh Tomato Sandwich",
        "description": "A light sandwich with tomato, cheese and onion.",
        "minutes": 10,
        "n_steps": 3,
        "ingredients": ["bread", "tomato", "cheese", "onion"],
        "quantity": [100.0, 100.0, 50.0, 20.0],
        "steps": ["Slice the vegetables.", "Assemble the sandwich.", "Serve fresh."],
        "tags": ["snack", "easy", "vegetarian"],
    },
]


def main():
    now = datetime.now(timezone.utc)
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    client.admin.command("ping")
    db = client[DATABASE_NAME]

    for recipe in RECIPES:
        db.recipes.replace_one({"id": recipe["id"]}, recipe, upsert=True)

    household = {
        "household_id": HOUSEHOLD_ID,
        "preferred_categories": ["easy", "vegetarian", "main-dish"],
        "disliked_ingredients": [],
        "dietary_constraints": [],
        "preferred_prep_time_range": {"min": 0.0, "max": 45.0},
        "difficulty_preference": "easy",
    }
    db.households.replace_one({"household_id": HOUSEHOLD_ID}, household, upsert=True)
    db.private_users.replace_one(
        {"household_id": HOUSEHOLD_ID},
        {"household_id": HOUSEHOLD_ID, "last_name": "Demo"},
        upsert=True,
    )
    db.credentials.replace_one(
        {"email": "demo@smartkitchen.local"},
        {
            "email": "demo@smartkitchen.local",
            "password_hash": generate_password_hash("Demo1234"),
            "household_id": HOUSEHOLD_ID,
        },
        upsert=True,
    )

    db.inventory.delete_many({"household_id": HOUSEHOLD_ID})
    inventory = [
        ("tomato", 850.0, "vegetables", 1),
        ("milk", 900.0, "dairy", 2),
        ("banana", 500.0, "fruit", 3),
        ("cheese", 400.0, "dairy", 6),
        ("chicken", 600.0, "protein", 8),
        ("bread", 500.0, "bakery", 5),
        ("egg", 600.0, "protein", 14),
        ("onion", 700.0, "vegetables", 21),
        ("rice", 1200.0, "pantry", 90),
        ("pasta", 1000.0, "pantry", 120),
    ]
    db.inventory.insert_many([
        {
            "household_id": HOUSEHOLD_ID,
            "product_name": name,
            "quantity_grams": quantity,
            "category": category,
            "expiry_date": now + timedelta(days=days),
        }
        for name, quantity, category, days in inventory
    ])

    db.recipes.create_index("id", unique=True)
    db.households.create_index("household_id", unique=True)
    db.credentials.create_index("email", unique=True)
    db.inventory.create_index("household_id")

    print("SmartKitchenDB demo data is ready.")
    print("Login: demo@smartkitchen.local / Demo1234")
    client.close()


if __name__ == "__main__":
    main()
