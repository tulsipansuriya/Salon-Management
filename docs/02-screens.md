# Screens & Features Specification

## Global Navigation & Controls
- **EN / GU Language Toggle**: Visible in the header on customer, reception, barber, and admin screens (hidden on `/display`). Switches all text immediately.
- **Staff Navigation**: Subtle top/bottom nav links on staff views (`/reception`, `/barber/ravi`, `/display`, `/admin`) for easy switching during demos.

---

## Screen 1: Home (`/`)
- **User**: Customer (mobile-first).
- **UI Elements (top to bottom)**:
  - Salon header with name/logo and status badge (`Open · Closes 9:00 PM` or `Online Queue Closed`).
  - Live summary card: e.g., `"6 people waiting · ~50 min wait"`.
  - Barber status chips: **Ravi**, **Amit**, **Imran** with live badges (`Free`, `Busy`, or `On Break`).
  - Primary gold CTA button: `[ Join Queue ]` (disabled with clear message if online queue is closed).
- **Empty State**: `"No one waiting — walk right in! (~0 min wait)"`.

## Screen 2: Join Queue (`/join`)
- **User**: Customer (mobile-first).
- **UI Elements (top to bottom)**:
  - Input fields: Customer Name (required) and Phone Number (required, exactly 10 digits).
  - Service cards (multi-select, **max 3 services**):
    - Haircut (`30 min`, `₹150`)
    - Beard Trim (`15 min`, `₹80`)
    - Hair Spa (`45 min`, `₹400`)
    - Head Massage (`20 min`, `₹120`)
    - Hair Color (`40 min`, `₹350`)
    - Facial Cleanup (`30 min`, `₹250`)
  - Barber picker: `"Any barber (fastest)"` (default) OR select **Ravi**, **Amit**, or **Imran**. If a selected barber is `On Break`, display warning: `"[Name] is currently on break — wait time may be longer"`.
  - Sticky live summary bar: Total duration, total price (`₹`), estimated wait time, and `[ Confirm & Get Token ]` button.
- **Error States**: Show clear inline messages for invalid phone numbers, >3 services selected, duplicate active phone number in queue, or closed online queue.

## Screen 3: My Status (`/status/:id`)
- **User**: Customer (mobile-first).
- **UI Elements**:
  - Large token badge (`S-1`, `S-2`, etc.) and queue position (`"4th in line"`).
  - Circular countdown timer showing estimated wait (`"~35 min"`), auto-updating via Socket.IO.
  - Selected services, assigned/preferred barber, and status badge (`Waiting`, `Called`, `In Chair`, `Done`, `Cancelled`).
  - **2nd-in-line alert banner**: When position reaches 2, show highlighted banner: `"You're almost up! Start heading to the salon."`
  - **Called state (`Called`)**: Full-screen gold takeover with gentle pulse animation: `"It's your turn! Go to [Barber Name]"` (triggers `navigator.vibrate` if supported).
  - `[ Cancel my spot ]` button (visible ONLY while status is `Waiting`; opens a confirmation dialog before cancelling).

## Screen 4: Reception Dashboard (`/reception`)
- **User**: Receptionist (10-inch tablet landscape layout).
- **UI Elements**:
  - **Top bar**: `[ + Add Walk-in ]` button (opens modal with Name, Phone, Services, Preferred Barber; works even when online joining is closed).
  - **Left panel (Barber Cards)**: 3 cards (Ravi, Amit, Imran) showing status (`Free`, `Busy`, `On Break`), current customer token/name, elapsed service timer, and `[ Call Next ]` button.
  - **Right panel (Waiting Queue)**: Ordered FCFS list showing Token, Customer Name, Phone, Services, Preferred Barber (`Any` or specific), and Waiting Time.
    - Rows waiting **> 60 minutes** are highlighted in **amber**.
    - Actions per row: `[ No-show ]` (when `Called`) and `[ Cancel ]` (when `Waiting`).
- **Empty State**: `"Queue is empty. Waiting for customers..."`.

## Screen 5: Barber View (`/barber/:name`)
- **User**: Individual Barber (`/barber/ravi`, `/barber/amit`, `/barber/imran`).
- **UI Elements**:
  - Header with Barber Name and `Available / On Break` toggle switch.
  - **Current Customer Card**: Token, customer name, services list, live timer since service started.
    - If status is `Called`: big gold `[ Start Service ]` button.
    - If status is `In Chair`: big green/gold `[ Done ]` button.
  - **Up Next Preview**: `"Next for you: S-15 Kunal (Haircut)"` (based on barber preference rules).
- **Empty State**: `"No customer in your chair right now."`.

## Screen 6: Waiting Area TV (`/display`)
- **User**: Lobby TV screen (optimized for `1920x1080`, dark background, zero navigation bars or scrollbars, readable from 5 meters).
- **UI Elements**:
  - **Left/Top Section ("Now Serving")**: Large row/card per active barber showing Barber Name and current token (`Now: S-12`).
  - **Right/Bottom Section ("Up Next")**: Next 5 waiting tokens in queue order with their estimated wait times.
  - **Animation**: When any token transitions to `Called`, flash its card in gold with a subtle pulse for **5 seconds** (plus optional Web Audio chime). Remove tokens once marked `Done`.

## Screen 7: Owner Settings (`/admin`)
- **User**: Salon Owner.
- **UI Elements**:
  - **Today's Stats Cards**: Customers Served, Average Wait Time (mins), and No-Shows count.
  - **Queue Control Switch**: Master toggle `Online Queue: OPEN / CLOSED`.
  - **Barbers on Duty**: Toggle switches for Ravi, Amit, and Imran (on/off duty today).
  - **Services Manager**: List of services with toggle switches (`Active / Hidden`), plus ability to add/edit service price and duration.