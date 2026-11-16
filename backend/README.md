# Caramello backend

The Express backend stores products and orders in PostgreSQL.

## Setup

1. Install PostgreSQL and create a database named `caramello`.
2. From this directory, install the Node.js dependencies:

   ```sh
   npm install
   ```

3. Copy `.env.example` to `.env` and set `DATABASE_URL` to your PostgreSQL connection string.
4. Start the server:

   ```sh
   npm start
   ```

The server creates the required tables on startup. To add the sample products, run `npm run seed` after configuring the database. The seed command does not overwrite existing products.

The backend serves the frontend and exposes API endpoints under `/api/products` and `/api/orders`.

## Frontend integration

- The admin panel syncs product changes to the server.
- The public site attempts to fetch products from the server and falls back to local storage.
- To share live updates across clients, open the site through the running backend at `http://localhost:3000`.

Existing SQLite records are not imported automatically. If you need that data, export it from a backup and import it into PostgreSQL.
