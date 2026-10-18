# Courier and Parcel Management System

## Requirements

- Node.js 20.19+ (or 22.12+)
- MongoDB, local or remotely managed

## Configure

1. Copy `backend/.env.example` to `backend/.env` and set `MONGO_URI` and a strong, private `JWT_SECRET`.
2. Optionally set mail credentials to enable parcel status email notifications.
3. Copy `frontend/.env.example` to `frontend/.env`. The Google Maps key is optional; maps and route directions are hidden unless configured.

Never commit `.env` files or share their values. If credentials were committed previously, rotate them and remove them from the repository history.

## Run locally

In one terminal:

```powershell
cd backend
npm install
npm start
```

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL printed in the frontend terminal (normally `http://localhost:5173`). The API starts after it connects to MongoDB.

## Admin and customer permissions

Public registration always creates a customer, even if a request submits a different role. There is no default admin password. Create an administrator from the backend terminal after configuring MongoDB:

```powershell
cd backend
npm run create-admin -- --email admin@parcelflow.local --name "Administrator"
```

The command generates a password and prints it once. Save it and sign in using that email and password. Alternatively, set `ADMIN_PASSWORD` in your private `backend/.env` (at least 12 characters). Optional `ADMIN_EMAIL` and `ADMIN_NAME` can supply the other values. Rerunning the command never resets passwords or promotes existing customer accounts.

| Permission | Customer | Admin |
| --- | --- | --- |
| Submit a booking request (Processing) | Yes | No |
| Accept a request and confirm booking (Booked) | No | Yes |
| View own parcels and tracking | Yes | Via all bookings |
| View all bookings and delivery metrics | No | Yes |
| View workspace users | No | Yes |
| Manage parcel delivery statuses | No | Yes |
| Change another account between admin and customer | No | Yes |
| Change own role | No | No |

Admins change roles in **People & permissions** on their dashboard. Existing delivery agent accounts retain their assigned-parcel workflow and are managed separately. Permissions are checked against the database for every protected HTTP request and socket connection. Role changes disconnect the affected account's existing sockets, and the frontend refreshes its session and opens the appropriate dashboard. Signed-out users go to sign-in; users opening another role's URL return to their own dashboard.

New parcel requests start as **Processing**. The admin dashboard shows these requests first with an **Accept booking** button. Only an admin can accept; acceptance changes the status to **Booked**, records the accepting admin and time, and creates the tracking QR code. Customer and admin dashboards receive live updates. After acceptance, admins can manage parcel delivery statuses directly from the admin dashboard; no agent account or assignment is required. A request cannot be assigned to an agent or moved into delivery while Processing. Repeated or concurrent acceptance attempts cannot confirm a request twice. Daily booking totals count confirmed bookings, and Processing requests have a separate count. Existing bookings keep their current status.

## Verify

```powershell
cd frontend
npm run lint
npm run build

cd ..\backend
npm test
```
