# User Flows, Business Rules & Test Checklist

## Core User Flows

### Flow 1: Remote Customer
1. Opens `/` -> sees live wait time -> taps `[ Join Queue ]`.
2. On `/join`, enters Name, 10-digit Phone, selects 1–3 services, chooses a barber or `"Any"`, and taps `[ Confirm ]`.
3. Backend creates queue record with sequential daily token (`S-1`, `S-2`...) and redirects to `/status/:id`.
4. Customer watches live wait countdown. At 2nd in line, sees `"Start heading to the salon"`.
5. Receptionist taps `[ Call Next ]` on a barber card -> status becomes `Called` -> customer phone turns full-screen gold `"It's your turn! Go to [Barber]"`, and `/display` flashes the token for 5 seconds.
6. Barber taps `[ Start Service ]` (`In Chair`), then `[ Done ]` (`Done`) -> customer leaves active queue and wait times recalculate for everyone behind.

### Flow 2: Walk-In Customer
1. Receptionist taps `[ + Add Walk-in ]` on `/reception`.
2. Enters customer details and services -> customer is added to the end of the same FCFS queue with the next sequential token.

---

## Strict Business Rules (Enforce on Backend)
1. **Forward-Only Status Transitions**:
   - Allowed: `Waiting` -> `Called` -> `In Chair` -> `Done`.
   - Exceptions: `Waiting` -> `Cancelled`; `Called` -> `No-show`.
   - Backward transitions (e.g., `Done` -> `Waiting` or `In Chair` -> `Called`) must be rejected with HTTP 400.
2. **Sequential Daily Tokens**:
   - Tokens follow `S-1`, `S-2`, `S-3`... resetting to `S-1` each calendar day.
3. **Barber Assignment ("Call Next")**:
   - First-come, first-served (FCFS).
   - Clicking `[ Call Next ]` for **Barber X** selects the earliest `Waiting` customer who either chose **Barber X** OR chose **`Any barber`**.
   - A customer who specifically chose **Ravi** MUST NEVER be assigned to **Amit** or **Imran**.
   - A barber can only have **one active customer** (`Called` or `In Chair`) at a time.
4. **Waiting Time Calculation**:
   - `Estimated Wait = ceil(Total service minutes of Waiting customers ahead / Number of active barbers not on break)` (minimum 0 if a matching barber is currently free).
5. **One Active Spot Per Phone Number**:
   - If a 10-digit phone number already has an active entry (`Waiting`, `Called`, or `In Chair`), block duplicate creation and return/redirect to their existing `/status/:id`.
6. **Service Limits**:
   - Minimum 1 service, maximum 3 services per booking. Disabled/hidden services cannot be booked.
7. **No-Show Re-queue Rule**:
   - If a `Called` customer is marked `No-show`, they leave the active queue. If they arrive later and re-join, they get a **new token at the end of the queue**.
8. **Closing Time Cutoff (8:30 PM / Manual Close)**:
   - Online joining (`/join`) closes 30 minutes before the 9:00 PM closing time (at **8:30 PM**) OR whenever the Owner switches the online queue to `CLOSED`.
   - Walk-in registration on `/reception` remains allowed even after online joining closes.
9. **Barber Break Rule**:
   - Toggling a barber to `On Break` excludes them from active barber capacity in wait-time math and displays a warning if a customer selects them on `/join`.

---

## Verification Test Checklist
- [ ] Join with 2 services -> accurate total duration, total price, and sequential token (`S-1`).
- [ ] Same phone joins twice while active -> prevented from creating duplicate; shown existing spot.
- [ ] Selecting > 3 services or < 10-digit phone -> blocked with clear error messages.
- [ ] Barber preference rule: Customer chooses Ravi -> Receptionist clicks `Call Next` for Amit -> Amit skips Ravi's customer and picks the next `Any` or `Amit` customer.
- [ ] Real-time sync: `Call Next` updates Customer `/status/:id` and TV `/display` within 2 seconds without refresh.
- [ ] Barber `Start Service` -> `Done` updates Reception, TV, and recalculates wait times for remaining customers.
- [ ] `No-show` removes customer from active queue; re-adding places them at the end with a new token.
- [ ] Closing online queue in `/admin` (or time >= 8:30 PM) disables `/join`, while `/reception` walk-ins still work.
- [ ] EN/GU language toggle translates all visible labels cleanly without text overflow.
- [ ] Refreshing the browser or restarting the backend preserves all SQLite queue data.