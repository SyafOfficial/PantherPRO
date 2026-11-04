# Member access and Guide

PantherPRO has one authenticated member audience. Published signals (including
volume signals), announcements and opted-in notifications are available to
members. Administrator tools still require the administrator role and MFA.
Anonymous visitors cannot read database signals.

VIP navigation, promotional cards, the membership screen, tier selectors and
the administrator tier-grant action are removed. Existing non-administrator tier
records and content audiences are normalized to the member audience. The empty
membership-entitlement table and tier-grant RPC are removed. Database constraints
prevent reintroducing tiered profile roles or content audiences.

The historical enum label remains solely for migration compatibility; it is
blocked by the profile constraint and is not an available membership feature.
Historical migrations and audit records are retained. Push subscriptions are
notification-device registrations and remain in place.

The navigation link is **Guide**, at `/guide`. The previous `/install` URL
redirects there. Installation, device notification setup and browser-specific
instructions remain available within the guide.
