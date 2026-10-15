# Smart Kitchen

Smart Kitchen is a full-stack recommendation system designed to help households manage food inventory, use products before they expire, and reduce food waste.

The project was developed collaboratively as a final degree project and received a grade of **98/100**.

## What the project does

- Tracks household food inventory, quantities, categories, and expiry dates.
- Stores dietary constraints, disliked ingredients, preferred categories, preparation time, and difficulty preferences.
- Recommends recipes that match the current inventory and household profile.
- Prioritizes ingredients that are close to expiration using FEFO logic.
- Records cooked and skipped recommendations and updates inventory after cooking.
- Provides two context-aware AI experiences: a global kitchen assistant and a recipe-specific assistant.
- Evaluates the recommendation model against a Logistic Regression baseline.

## Technology stack

| Layer | Technologies |
| --- | --- |
| Frontend | Angular 16, TypeScript, HTML, CSS, RxJS |
| Backend | Python, Flask, Flask-CORS |
| Database | MongoDB 7 |
| Machine learning | scikit-learn, Random Forest, Logistic Regression, TF-IDF, cosine similarity |
| Data processing | pandas, NumPy, joblib |
| Local AI | Ollama with `llama3.2` |

## Architecture

```text
User
  |
Angular frontend
  |
Flask REST API
  |-- MongoDB: users, preferences, inventory, recipes and events
  |-- Recommendation engine: TF-IDF, cosine similarity, FEFO and Random Forest
  `-- Ollama: locally generated, context-aware answers
```

## Recommendation engine

The engine first removes recipes that violate hard dietary constraints. It then evaluates each remaining recipe using three main dimensions:

1. **Inventory match** - TF-IDF represents recipe ingredients and household inventory as vectors, while cosine similarity measures their content match.
2. **Personal fit** - a pointwise Random Forest model predicts how well a recipe fits a household using seven contextual features.
3. **Expiry priority** - FEFO gives preference to recipes that use products close to expiration.

The final ranking score is:

```text
60% inventory match + 25% personal fit + 15% FEFO
```

The saved model artifact also includes a Logistic Regression baseline that uses FEFO, preparation-time fit, and difficulty fit.

## AI assistants

Both assistants use the same locally hosted Ollama model but receive different context:

- **Kitchen Assistant** receives the current page, household inventory, and preferences.
- **Recipe Assistant** additionally receives the selected recipe and its ingredients.

Flask retrieves the relevant structured data from MongoDB, adds it to a bounded prompt, and sends the prompt to Ollama. This is a lightweight form of database-backed RAG: retrieval and prompt augmentation are used without a vector database or embeddings.

## Evaluation results

The final model and baseline were evaluated on the same candidate pool of 5,000 recipes and the same household contexts.

| Metric | Final model | Baseline | Relative improvement |
| --- | ---: | ---: | ---: |
| NDCG@5 | 0.235 | 0.144 | 63.3% |
| Normalized R-Score@5 | 0.167 | 0.109 | 53.9% |

The locked test evaluation included 162 impressions from 162 households. The academic evaluation used synthetic interaction data, so the results demonstrate technical feasibility rather than real-world behavioral impact.

## Repository structure

```text
SmartKitchenAI/
  README.md                  Project overview and setup instructions
  smartkitchen3/
    frontend/                Angular application
    backend/
      app.py                 Flask API and recommendation pipeline
      seed_demo_data.py      Small public demo dataset
      train_model.py         Model training pipeline
      metrics_evaluation.py  Offline ranking evaluation
      evaluation_protocol.py Household-level data split
      recommendation_model.pkl Trained model artifact
      requirements.txt       Python dependencies
```

Large MongoDB exports, virtual environments, package caches, build output, and private user records are intentionally excluded from this repository.

## Prerequisites

- Node.js 18 and npm
- Python 3.12 or 3.13
- MongoDB Community 7.x
- Ollama

The core inventory and recommendation features work without Ollama. Ollama is required only for the AI assistants.

## Run locally

Download and extract the repository ZIP, or clone the repository. The repository root is the folder containing this README and the `smartkitchen3` directory.

### 1. Start MongoDB

On macOS with Homebrew:

```bash
brew services start mongodb/brew/mongodb-community@7.0
```

MongoDB must be available at `mongodb://127.0.0.1:27017/`. The application uses the database name `SmartKitchenDB`.

### 2. Create the Python environment

From the repository root, enter the application folder first:

```bash
cd smartkitchen3
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install --upgrade pip
python3 -m pip install -r backend/requirements.txt
```

Run steps 3 and 4 from this same terminal, inside `smartkitchen3`, with the virtual environment active.

### 3. Load the lightweight demo data

```bash
python3 backend/seed_demo_data.py
```

Demo login:

```text
Email: demo@smartkitchen.local
Password: Demo1234
```

The seed script is idempotent and contains only fictional public demo data.

### 4. Start the Flask API

```bash
python3 backend/app.py
```

The API runs at `http://localhost:5000`. Keep this terminal open.

### 5. Start Ollama

In a separate terminal:

```bash
ollama pull llama3.2
ollama serve
```

Ollama runs at `http://localhost:11434`.

### 6. Start Angular

In another terminal, start from the repository root:

```bash
cd smartkitchen3/frontend
npm install
npm start
```

Open `http://localhost:4200`.

## Optional model workflows

The repository includes the trained model, so training is not required to run the application. With a compatible research dataset loaded into MongoDB, the following commands can be used from inside `smartkitchen3`, with the Python virtual environment active:

```bash
python3 backend/train_model.py
python3 backend/metrics_evaluation.py
```

The full academic dataset is not distributed in this portfolio repository because of its size and because database exports may contain account or household records.

## Privacy and safety

- Ollama runs locally, reducing the need to send household context to an external model API.
- Passwords are stored as hashes rather than plaintext.
- The AI assistant receives bounded context and is instructed not to claim that it changed application data.
- Local model execution does not replace authentication, database security, input validation, or output review.

## Academic context

This repository is a cleaned portfolio edition of a collaborative final degree project. It focuses on the application source code, recommendation architecture, reproducible setup, and a small fictional demo dataset. Generated caches, local environments, large research exports, submission documents, and private records are excluded.
