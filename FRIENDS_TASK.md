# Tablemate — Implement Account Friends System

Repository: https://github.com/AkhilKarthik143/poker-chips

## Objective

Implement a complete, secure, persistent friends system for Tablemate.

Users with accounts should be able to discover other users, send and receive friend requests, manage friendships, and easily play poker together.

The feature should feel naturally integrated into Tablemate's existing account experience, not like a separate social networking application.

**Preserve the core poker application, guest play, game logic, existing themes, and account authentication.**

## 1. Inspect the existing architecture

Before writing code, inspect the current working branch and determine:

- How accounts are created and authenticated.
- How unique account IDs and usernames are stored.
- Which database or persistent-storage system accounts use.
- How account sessions work.
- Whether profiles and account menus already exist.
- How accounts are associated with poker seats.
- How Socket.IO and existing notifications operate.
- How table invitations and room codes work.
- Whether league functionality has already been implemented.

Read relevant source files and existing tests.

**Important:** The public main README may be outdated and currently describes a guest-only architecture. Inspect the actual working branch. If durable accounts do not exist, report that prerequisite clearly rather than building a fake friendship system using temporary seat identities.

Do not create a second account model or authentication mechanism.

---

## 2. Implement the friends system

Every signed-in user should be able to:

1. Search for registered users by username.
2. Send a friend request.
3. View incoming friend requests.
4. Accept or decline incoming requests.
5. View outgoing pending requests.
6. Cancel outgoing requests.
7. See their accepted friends.
8. Remove existing friends.
9. Block and unblock other users.

Relationships must be mutual only after a request is accepted.

A person should not automatically become someone else's friend simply because they join the same table.

### Friend request states

Support:

- Not friends
- Request sent
- Request received
- Friends
- Blocked

These states should be synchronized across both accounts.

Prevent:

- Friending yourself
- Duplicate pending requests
- Duplicate friendships
- Requests to blocked users
- Accepting someone else's request
- Unauthorized removals
- Race conditions from simultaneous requests

If two users send requests to each other simultaneously, handle the situation deterministically without duplicate records.

---

## 3. Build the Friends interface

Add a **Friends** entry to the existing account navigation.

The page or panel should contain three sections.

### My Friends

Display each friend's:

- Avatar or generated initials
- Display name
- Unique username
- Friendship status
- Contextual actions

Provide actions such as:

- View profile
- Invite to table, where supported
- Remove friend
- Block user

Keep the friend list compact and mobile-friendly.

### Friend Requests

Separate incoming and outgoing requests.

Incoming:

- Accept
- Decline

Outgoing:

- Pending status
- Cancel request

Show a small request-count indicator in the account navigation when requests are waiting.

### Find Friends

Provide a search field for usernames.

Results should display the account's avatar, display name, and username.

Contextual actions should reflect the current relationship:

- Add friend
- Request sent
- Accept request
- Friends
- Unavailable

Use debounced search and sensible result limits.

Show useful empty states, loading feedback, and error messages.

Do not expose email addresses, session tokens, or private account information in search results.

---

## 4. Add friends directly from a poker table

This should be an important Tablemate-specific feature.

When tapping another player's occupied seat, allow the user to view that player's account profile and send a friend request.

However:

- Show this only when the seat is linked to a verified account.
- Never assume matching display names mean matching accounts.
- Guest players should not be represented as registered users.
- Prevent a user from friending their own account.
- Do not reveal account identifiers that are intended to remain private.
- Do not interrupt betting or interfere with existing seat controls.

The new interaction should be lightweight and fit within the existing player-details interface.

During an active hand, account social operations must not mutate poker state or change whose turn it is.

---

## 5. Integrate friends with table invitations

Make it easier to play with existing friends.

When a user has created or joined a table, provide access to a friend's invitation option using the existing room-invite system.

Reuse existing room codes and invite URLs.

Where an authenticated account notification mechanism exists, support sending an invitation directly to a friend.

A table invitation should contain only the information needed to join.

- Never transmit seat bearer tokens.
- Never automatically join or seat a friend.
- Never bypass table capacity or normal joining rules.
- Handle expired or nonexistent tables.
- Do not imply an invitation was delivered unless the backend confirms it.

If account-to-account invitation delivery requires substantial new infrastructure, prioritize the complete friendship system and retain the existing copy/share invitation workflow. Report invitation delivery as a separate follow-up instead of implementing a misleading button.

---

## 6. Persistent backend and database

Friendships are account-level data and must survive:

- Browser refreshes
- Logout and login
- Switching devices
- Server restarts
- Room expiration

Use the application's existing account database and migration conventions.

Do not store friendships only in localStorage or process memory.

### Recommended data model

Represent each friendship/request with:

- Stable user IDs for both participants
- Request sender
- Request recipient
- Relationship status
- Created timestamp
- Updated timestamp
- Accepted timestamp, where applicable

Use an appropriate relational model that supports a unique unordered pair of users.

Track blocks separately if that better fits the existing schema and simplifies authorization.

Enforce uniqueness and valid transitions at the database/service layer, not just the UI.

Use transactions for concurrent mutations.

Ensure both sides observe a consistent relationship state.

Do not use usernames as permanent relationship identifiers, because usernames may change.

---

## 7. API and authentication

Use the project's existing API architecture.

Add endpoints or authenticated Socket.IO operations for:

- Search users
- List friends
- List incoming requests
- List outgoing requests
- Send request
- Accept request
- Decline request
- Cancel request
- Remove friend
- Block user
- Unblock user

Do not blindly implement both HTTP and Socket.IO versions of every operation.

Use the existing architecture and whichever transport is most appropriate.

All account mutations must derive the acting user from the authenticated session.

Never trust a client-supplied sender ID or arbitrary claimed account identity.

Validate every request and return consistent errors.

Rate-limit username searches and friend requests to reduce spam and enumeration.

Use database constraints and idempotent operations where appropriate.

---

## 8. Notifications

Add in-app notifications for:

- New incoming friend request
- Accepted friend request
- Table invitation, if implemented

Reuse the existing notification components where possible.

Notifications should be nonintrusive.

Do not trigger turn-alert sounds or vibration for routine social actions.

Do not add unsolicited Web Push notifications or register new push subscriptions without explicit user preferences.

Friend requests should remain visible after a reload, even if a real-time notification was missed.

Keep gameplay notifications and account notifications logically separate.

---

## 9. Privacy and blocking

Privacy is important.

Implement these rules:

- Do not expose email addresses through friend search.
- Do not expose private account or authentication tokens.
- A blocked user cannot send new friend requests.
- Blocking removes or invalidates any friendship and pending requests.
- Unblocking does not automatically restore a previous friendship.
- Users can view and manage their blocked-user list.
- Search results disclose only approved public profile fields.
- Do not expose real-time presence or active table membership unless explicitly supported by existing privacy settings.
- Existing guest/table access must not become dependent on friendship.

Handle account deletion and username changes without orphaning friendship data.

---

## 10. UI design

Match Tablemate's current Playful Geometric design system.

Preserve all existing themes, including any new themes implemented in the working branch.

Use:

- Rounded outlined panels
- Existing typography
- Theme-aware accent colors
- Compact profile avatars
- Clearly differentiated request states
- Accessible buttons
- Visible focus indicators
- Clean empty states
- Responsive mobile layouts

Do not create a large social dashboard or feed.

The Friends interface should be understandable in a few seconds.

Keep decorations minimal. Theme-specific graphics should not obstruct search results, requests, or action buttons.

Ensure the interface looks correct in Felt, the alternate themes, and System mode.

---

## 11. Compatibility with leagues

The friendship system should be independent of league membership.

Users should be allowed to:

- Be friends without being in the same league.
- Join the same league without being friends.
- Leave a league without losing friendships.

Use stable account IDs so the friends system can later support inviting friends into leagues.

Do not implement league scheduling, RSVP, scoring, standings, or other league features as part of this task.

---

## 12. Testing

Add automated tests covering:

1. Searching for an existing registered user.
2. Searching for a nonexistent username.
3. Sending a request.
4. Accepting a request.
5. Declining a request.
6. Canceling an outgoing request.
7. Removing a friend.
8. Blocking and unblocking.
9. Duplicate request handling.
10. Simultaneous requests between the same users.
11. Attempting to friend yourself.
12. Unauthorized accept/remove attempts.
13. Friendships surviving server restarts.
14. Username changes.
15. Account deletion.
16. Friends lists across multiple devices.
17. Requests from or to blocked accounts.
18. Adding a friend from an authenticated table seat.
19. Guest players remaining unaffected.
20. Existing poker gameplay and settlement tests continuing to pass.

Also test search rate limiting, malformed payloads, and unauthenticated requests.

### Commands

Run the repository's applicable checks, including:

```bash
npm test
npm run lint
node scripts/simulate-four.js
```

Run any database migration, type-checking, and integration-test commands required by the current account implementation.

Use real browser testing where available to verify request acceptance, list synchronization, mobile layouts, and notifications.

---

## 13. Out of scope

Do not add:

- Direct messaging
- Public activity feeds
- Social posts
- Global friend leaderboards
- Friend rankings
- Friend recommendations based on private information
- Head-to-head poker statistics
- Persistent online tracking
- Automatic league enrollment
- New payment features
- Changes to poker rules

Those features can be considered separately.

---

## Final deliverables

Complete the friends system end to end.

Report:

1. Existing account architecture discovered.
2. Database schema/migrations added.
3. APIs and authorization implemented.
4. Friends interface created.
5. Table integration completed.
6. Notification/invitation capabilities implemented.
7. Test results and any failing checks.
8. Remaining limitations.

### Acceptance criteria

Two users with registered accounts should be able to search for each other, send a friend request, accept it, see each other in their friends lists, and remove or block each other.

Their friendship should remain intact across device changes, logouts, and server restarts.

A user should also be able to start a friendship from another verified account's poker seat without affecting gameplay.

**Build this as a genuine persistent account feature, not an in-memory demo or a frontend-only mockup.**