# Connecting the frontend

Base URL: `https://<your-api-host>/api/v1`. Swagger lives at `/docs` (not in production).
A frontend on HTTPS (Vercel) must call an HTTPS API once deployed; during development `http://localhost:3000` works from the browser.

## CORS
Set `CORS_ORIGINS` on the API to a comma-separated list. `*` matches one hostname label, so
`https://jajacare.vercel.app,https://jajacare-*.vercel.app,http://localhost:5173` covers production, every Vercel preview deployment and local dev.

## Authentication
1. `POST /auth/login` with `{ identifier, password }` (staff ID or email) returns `{ accessToken, refreshToken, user }`.
2. Send `Authorization: Bearer <accessToken>` on every call. The access token lasts 15 minutes.
3. On a `401`, call `POST /auth/refresh` with `{ refreshToken }`, store BOTH new tokens, and retry the request once. If refresh fails, go to the login page.
4. **Refresh tokens rotate: use each one once.** Run refresh as a single in-flight request (queue other requests behind it). Two parallel refreshes with the same token look like token theft and end the session.
5. `POST /auth/logout` with `{ refreshToken }` ends the session server-side.
6. Idle logout: if no request refreshes the session for 30 minutes, the next refresh fails. For a stricter feel, also run a client-side idle timer that calls logout.
7. `user.mustChangePassword === true` (or a `403` with `code: "PASSWORD_CHANGE_REQUIRED"`): send the user to the change-password screen (`POST /auth/change-password`). It returns fresh tokens.
8. Forgot password: `POST /auth/forgot-password { email }` (always 202), then `POST /auth/reset-password { token, newPassword }`.

## Conventions
- Errors: `{ statusCode, message, error }`. Validation errors have `message` as an **array of strings**, one per problem.
  Special bodies: `{ code: "ALLERGY_CONFLICT", conflicts: [{drug, allergy}] }` and `{ code: "PASSWORD_CHANGE_REQUIRED" }`.
- Lists: `?page=1&limit=20` returns `{ data, meta: { total, page, limit, pages } }`.
- Timestamps are ISO 8601 UTC. Show them in Africa/Lagos. Day filters (`date`, `from`, `to`) are Lagos calendar days as `YYYY-MM-DD`.
- Enums: `Role` ADMIN, RECEPTIONIST, NURSE, DOCTOR. Blood group `A_POS`, `A_NEG`, `B_POS`, `B_NEG`, `AB_POS`, `AB_NEG`, `O_POS`, `O_NEG` (map to "A+" in the UI). Genotype AA, AS, SS, AC, SC.

## Show or hide by role (`user.role`)
| UI | Admin | Receptionist | Nurse | Doctor |
|---|---|---|---|---|
| Dashboard | yes | yes | yes | yes |
| Register / edit patient | yes | yes | no | no |
| Patient list, profile overview | yes | yes | yes | yes |
| Visit history, prescriptions tabs | yes | no | no | yes |
| Delete patient | yes | no | no | no |
| Book / reschedule / cancel / no-show | yes | yes | no | no |
| Check in | yes | yes | yes | no |
| Record vitals | yes | no | yes | yes (own) |
| Start / complete consultation | start only | no | no | yes (own) |
| User management, clinic settings (write), audit log | yes | no | no | no |

The API enforces all of this too; the table is just for hiding buttons. A forbidden call returns 403.

## Screen to endpoint map
- **Login:** `/auth/login`, `/auth/forgot-password`, `/auth/reset-password`
- **Register patient:** `POST /patients` (returns the new `patientNo`); duplicate matric gives a 409 with the existing patient ID
- **Patients list:** `GET /patients?search=&faculty=&registeredFrom=&registeredTo=&sortBy=&order=&page=&limit=`
- **Patient profile:** `GET /patients/:id`, tabs: `/patients/:id/visits`, `/prescriptions`, `/appointments`
- **Appointments:** `GET /appointments/doctors`, `/appointments/slots?doctorId&date`, `POST /appointments`, `GET /appointments/calendar?from&to`, `GET /appointments/queue`, then `/:id/check-in`, `/cancel`, `/no-show`, `/start`, `PATCH /:id/reschedule`
- **Consultation:** `GET /consultations/by-appointment/:appointmentId`, `PATCH /consultations/:id` (save draft), `POST /consultations/:id/complete`, `GET /consultations/:id/prescription` (print), `GET /diagnoses/search?q=`, vitals at `PATCH|GET /appointments/:id/vitals`
- **Dashboard:** `GET /dashboard` (stat cards; doctors also get `myAppointmentsToday`), `GET /dashboard/weekly-visits` (7 zero-filled days for the line chart), `GET /dashboard/activity?limit=10` (feed items with a ready-made `message`)
- **Landing page:** `GET /public/clinic-info` (name, hours, address, email, phone, no login), `POST /contact` with `{ name, email, message, website }`. Keep `website` as a hidden empty field in the form: bots fill it in and are silently ignored. Limited to 5 messages an hour per IP.
- **Settings:** `GET|PATCH /settings/clinic` (also address, contactEmail, contactPhone), users at `/users` (admin), contact inbox `GET /contact/messages`, `PATCH /contact/messages/:id/read` (admin)

## Consultation screen tips
- Load once; keep the returned `updatedAt` and send it back as `expectedUpdatedAt` when saving, so two open tabs cannot silently overwrite each other (you get a 409).
- `diagnoses` and `prescriptions` replace the stored lists when sent; omit them to leave them unchanged.
- The response includes `vitals.flags` (LOW / NORMAL / HIGH / CRITICAL) for highlighting and `allergyWarnings` for a live banner while prescribing.
- "Complete consultation" accepts the same body as save, so you can save and lock in one call. If it returns `ALLERGY_CONFLICT`, show the conflicts and re-send with `confirmAllergyOverride: true` if the doctor confirms.
- After completion the record is read-only (further saves return 409).

## Check-in bell (Server-Sent Events)
```js
const { ticket } = await api.post('/notifications/ticket');           // normal authenticated call
const es = new EventSource(`${API}/api/v1/notifications/stream?ticket=${ticket}`);
es.addEventListener('appointment.checked_in', (e) => showBell(JSON.parse(e.data)));
es.onerror = () => { es.close(); /* get a new ticket, reconnect, then refetch GET /appointments/queue */ };
```
Tickets are single use and expire after 30 seconds, so every reconnect needs a new one. Events are not stored: after reconnecting, refetch the queue.
