# Bài học (ratchet)

Mỗi dòng là một lỗi Claude đã mắc khi làm ticket, và lớp đã dùng để sửa sao cho lỗi không lặp lại.

**Nguyên tắc:** sửa ở lớp mạnh nhất làm được. Lỗi đã ghi ở đây mà lặp lại thì nâng lên lớp mạnh hơn.

| Lớp | Độ tin cậy | Ví dụ |
|---|---|---|
| Nhắc trong chat | Thấp, mất khi hết phiên | "lần sau nhớ..." |
| Hướng dẫn | Trung bình, Claude có thể quên | Hướng dẫn quy trình trong `src/index.ts`, prompt `lam-task` |
| Sensor | Cao, máy tự bắt | Quy tắc trong `src/sensors.ts`, chạy trong `git_review_diff` |
| Ràng buộc tool | Cao nhất, không thể làm sai | Tool không nhận tham số, bắt buộc tham số, chặn nhánh/câu SQL |

**Cách thêm:** khi Claude sai mà dev phải sửa, thêm 1 dòng (ngày, lỗi, lớp sửa, chỗ sửa). Lỗi lặp nhiều trong `node scripts/audit-report.mjs` cũng là ứng viên.

| Ngày | Lỗi | Lớp sửa | Chỗ sửa |
|---|---|---|---|
| 2026-11-16 | Mô tả PR tự sinh nội dung và dòng "Generated with Claude Code" | Ràng buộc tool | `bb_create_pull_requests` không nhận title/description; title = tên nhánh, mô tả trống |
| 2026-11-16 | Comment code chứa mã Jira (`// EBW-67919: ...`) | Hướng dẫn → **Sensor** | Quy tắc `jira-key-in-comment` |
| 2026-11-16 | Dùng `List<Object[]>` cho kết quả query | Hướng dẫn → **Sensor** | Quy tắc `list-object-array` |
| 2026-11-16 | Dev yêu cầu: chưa thống nhất nguyên nhân thì không được sửa code | Hướng dẫn → **Ràng buộc tool** | `git_start_branch` bắt buộc `causeSummary` + `userConfirmed=true` |
| 2026-11-16 | Phòng ngừa (chưa xảy ra): chuyển trạng thái / ghi comment Jira mà chưa hỏi | **Ràng buộc tool** | `jira_transition`, `jira_add_comment` bắt buộc `userConfirmed=true` |
| 2026-11-16 | Xếp null không nhất quán giữa Java (`nullsLast`) và SQL Server (null đứng đầu) trong cùng một tính năng | Hướng dẫn (reviewer) | Khó viết thành quy tắc cố định; reviewer kiểm tra |
| 2026-11-16 | Worklog chỉ viết sau khi tạo PR; mở phiên mới giữa chừng không biết đã làm tới đâu | **Ràng buộc tool** | `git_start_branch` tạo worklog; commit/PR/build/Jira tự ghi nhật ký |
