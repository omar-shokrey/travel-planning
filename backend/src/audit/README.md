# audit

The audit log of administrator actions (GEN-07): "The system shall keep an audit log of admin actions (suspensions, deletions)." This module owns the `audit_logs` collection and `AuditService`. It has no controller: the admin console shows the log at `GET /api/admin/audit-logs` (see `backend/src/admin/README.md`).

## Design decisions

- **The view is in `admin`, the records are here.** The module table of `specs/travel-platform.md` gives `admin` the "audit log views" under `/api/admin/*` and `audit` the "administrative audit records", "used by `admin`". So `AdminController` has the route, `AdminService` maps the page, and `AuditService` owns the collection and returns entities, the same split as the account list (ACC-14) with `UsersService`. The response DTO and the mapper live here, next to the entity, as `UserResponseDto` lives in `users`.
- **Field names follow the spec's `AUDIT_LOG` entity:** `adminId`, `action`, `targetType`, `targetId`, `details`, plus `createdAt`. `adminId` is an ObjectId; `targetId` is a string, as in the spec, so any kind of target fits. `details` is a short public note (at most 500 characters), not a free object, so nothing private can slip in by accident.
- **Append-only.** `AuditService` has two methods, `record` and `list`; there is no update or delete method and no route that changes a record. The schema keeps `createdAt` only (`timestamps: { createdAt: true, updatedAt: false }`). Only the e2e tests delete the records their own actions wrote, by id, in the `-test` database (`test/support/delete-audit-logs.ts`).
- **A failed audit write does not fail the admin's request.** `record` is called after the admin action has been saved. If the write fails, the action has already happened and cannot be rolled back here (a password reset has also ended sessions), so an error would make the admin retry something that already happened (for example a moderator creation would then answer 409). `record` catches the error and logs it on the server with the action, the target and the admin id, never the note. The same rule as `NotificationsService.notify` (GEN-01). The cost is that a record can be missing after a database failure; the server log shows it.
- **A note longer than 500 characters is cut, not refused** (`AUDIT_DETAILS_MAX_LENGTH`). The schema limits `details` to 500, and a provider name can be longer (an airline's name has no limit at creation), so `record` cuts it before the write instead of losing the record.
- **Indexes and `targetId` alone:** `?targetId=` without `targetType` cannot use the `{ targetType, targetId, createdAt }` index. The log is small and read by admins only, so no extra index was added; one can be added if the list gets slow.
- **Nothing private is recorded.** No password, hash, token, email or request body. The note of a moderator creation is the role and the provider (`hotel_moderator of hotel <id>`); of a suspension or reactivation, the role of the account (`user`, `hotel_moderator`, …); of a provider deactivation or reactivation, the provider's name, which is public. A password reset has no note.
- **`action` and `targetType` are enums** (`AuditAction`, `AuditTargetType`, lowercase snake_case), so the list filters can be validated and the frontend can show a label per value.
- **Indexes** serve the list, newest first, with or without a filter: `{ createdAt: -1, _id: -1 }`, `{ adminId: 1, createdAt: -1 }`, `{ action: 1, createdAt: -1 }` and `{ targetType: 1, targetId: 1, createdAt: -1 }`.

## Actions

| `action`              | `targetType`                             | Requirement | Recorded                                         |
| --------------------- | ---------------------------------------- | ----------- | ------------------------------------------------ |
| `reset_password`      | `user`                                   | ACC-07a     | Yes, in `AdminService.resetPassword`             |
| `create_moderator`    | `user`                                   | ACC-13      | Yes, in `AdminService.createModerator`           |
| `suspend_user`        | `user`                                   | ACC-15/16   | Yes, in `AdminService.suspend`                   |
| `reactivate_user`     | `user`                                   | ACC-15/16   | Yes, in `AdminService.reactivate`                |
| `deactivate_provider` | `airline`, `hotel`                       | ACC-15      | Yes, in `AdminService.deactivateProvider`        |
| `reactivate_provider` | `airline`, `hotel`                       | ACC-15      | Yes, in `AdminService.reactivateProvider`        |
| `dismiss_report`      | `report`                                 | GEN-10      | Yes, in `AdminModerationService.resolveReport`   |
| `hide_content`        | `post`, `comment`, `review`, `itinerary` | GEN-10      | Yes, through a report and directly               |
| `show_content`        | `post`, `comment`, `review`, `itinerary` | GEN-10      | Yes, in `AdminModerationService.moderateContent` |
| `delete_content`      | `post`, `comment`, `review`, `itinerary` | GEN-10      | Yes, through a report and directly               |

`suspend_user` and `reactivate_user` cover every account (users and moderators): a moderator account is a user record with a moderator role.

## How another admin action records itself

After its own write has succeeded, the service calls:

```ts
await this.audit.record({
  adminId, // from @CurrentUser('id') in the controller
  action: AuditAction.SuspendUser,
  targetType: AuditTargetType.User,
  targetId: account._id,
  details: 'optional short public note',
});
```

Its module imports `AuditModule`. An action that is refused (404, 403, 409…) records nothing.
