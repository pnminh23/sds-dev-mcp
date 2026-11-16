# Hướng dẫn sử dụng sds-dev-mcp

Tài liệu dành cho dev đã cài xong MCP (xem phần cài đặt trong [README](../README.md)).
Nội dung: quy trình làm ticket, 4 lệnh tắt, 18 tool, câu hỏi mẫu, review độc lập, đọc DB, xử lý lỗi.

---

## Mục lục

1. [Bắt đầu nhanh](#1-bắt-đầu-nhanh)
2. [Trạng thái Jira và quy trình](#2-trạng-thái-jira-và-quy-trình)
3. [Lệnh tắt](#3-lệnh-tắt)
4. [Nói chuyện bình thường với Claude](#4-nói-chuyện-bình-thường-với-claude)
5. [Danh sách tool chi tiết](#5-danh-sách-tool-chi-tiết)
6. [Review code độc lập](#6-review-code-độc-lập)
7. [Đọc database](#7-đọc-database)
8. [Việc Claude tự làm và việc phải hỏi](#8-việc-claude-tự-làm-và-việc-phải-hỏi)
9. [Một ngày làm việc mẫu](#9-một-ngày-làm-việc-mẫu)
10. [Câu hỏi thường gặp và xử lý lỗi](#10-câu-hỏi-thường-gặp-và-xử-lý-lỗi)

---

## 1. Bắt đầu nhanh

Mở Claude Code ở bất kỳ repo nào rồi gõ:

| Muốn | Gõ |
|---|---|
| Xem hôm nay có việc gì | `/mcp__sds-dev__viec-cua-toi` |
| Làm trọn một ticket | `/mcp__sds-dev__lam-task EBW-67919` |
| Review code của ticket | `/mcp__sds-dev__review-code EBW-67919` |
| Kiểm tra đã build lên môi trường chưa | `/mcp__sds-dev__kiem-tra-build EBW-67919 dev-99` |

Không nhớ tên lệnh: gõ `/` rồi gõ `sds` để lọc.

Lần đầu mỗi tool được gọi, app hỏi quyền → chọn cho phép luôn.

---

## 2. Trạng thái Jira và quy trình

### Trạng thái

| Trạng thái | Ai chuyển | Ý nghĩa | Nằm trong "việc cần làm"? |
|---|---|---|---|
| **To do** | Tester | Giao việc, chưa làm | Có |
| **In Progress** | Dev (MCP tự chuyển) | Đang làm | Có |
| **Reopened** | Tester | Trả lại từ In Review vì chưa đúng yêu cầu | Có, ưu tiên cao nhất |
| **In Review** | Dev (MCP hỏi trước) | Đã sửa, đã build, chờ tester | Không |
| **Done Test** | Tester | Xong | Không |

Quy tắc: **bắt đầu code ticket nào thì ticket đó phải ở In Progress.** Việc chuyển gắn vào tool tạo nhánh `git_start_branch`: tạo nhánh cho ticket là ticket tự sang In Progress, dù bạn dùng `lam-task` hay chỉ nói "sửa bug X". Chỉ đọc, phân tích ticket thì trạng thái không đổi.

### Quy trình một ticket

```
 Jira To do / Reopened
        │  jira_get_issue (chỉ đọc, chưa đổi trạng thái)
        ▼
 Xác định repo (be / fe / queue / coremodel / report), tìm nguyên nhân
        │  (đọc code, db_* chỉ SELECT; chưa tạo nhánh, chưa sửa file)
        ▼
 XÁC NHẬN NGUYÊN NHÂN  ── Claude DỪNG, trình bày nguyên nhân + bằng chứng
        │                 + vị trí code + hướng sửa; bạn hỏi lại / bổ sung /
        │                 đổi hướng đến khi thống nhất
        │  bạn đồng ý rõ ràng
        │  git_start_branch → nhánh fixbug|task/<user>/<KEY> từ prod
        │                   + ticket tự chuyển sang In Progress
        ▼
 Sửa code, build kiểm tra
        │
        ▼
 REVIEW ĐỘC LẬP  (subagent mới, không phải phiên viết code)
        │  sửa theo review, review lại nếu có sửa
        ▼
 git_commit_push  → commit "fixbug/<user>/<KEY>" + push
        │
 bb_create_pull_requests → PR vào các nhánh môi trường (prTargets)
        │
        ├── conflict? → DỪNG, bạn tự xử lý trên nhánh môi trường
        ▼
 Worklog → <worklogDir>/<KEY>.md (nguyên nhân, cách xử lý, repo/nhánh, link PR)
        │
        ▼
 PR merged → build_check → ĐÃ BUILD?
        │
        ▼
 jira_transition → In Review   (hỏi bạn trước)
```

---

## 3. Lệnh tắt

Lệnh tắt là kịch bản có sẵn: Claude làm đúng các bước theo thứ tự, không bỏ bước.

### 3.1 `/mcp__sds-dev__viec-cua-toi`

**Dùng khi:** đầu ngày, hoặc xong một ticket muốn biết làm gì tiếp.

**Tham số:** không có.

**Claude làm:**
1. Gọi `jira_search` (mặc định: Reopened + In Progress + To do của bạn).
2. Chia 3 bảng theo thứ tự **Reopened → In Progress → To do**: mã | loại | độ ưu tiên | tóm tắt | cập nhật.
3. Gợi ý ticket nên làm tiếp và lý do.

**Không hiện:** ticket In Review, Reject, Done Test. Muốn xem thì hỏi "các ticket đang In Review của tôi".

---

### 3.2 `/mcp__sds-dev__lam-task <KEY>`

**Dùng khi:** bắt đầu làm một ticket, kể cả ticket bị Reopened.

**Tham số:** `key` – mã Jira, vd `EBW-67919`, `EB133-6806`, `EB88-11757`.

**Claude làm, theo thứ tự:**

| Bước | Việc | Tool |
|---|---|---|
| 1 | Đọc ticket: yêu cầu, môi trường, loại (bug → `fixbug`, task → `task`) | `jira_get_issue` |
| 1 | Nếu ticket **Reopened**: đọc comment tester để biết lý do, làm tiếp trên nhánh cũ | `jira_get_issue` |
| 2 | Đọc code, xác định repo và nguyên nhân, kèm bằng chứng. Chưa tạo nhánh, chưa sửa file. Yêu cầu mơ hồ → **hỏi bạn** | đọc file, `db_*` |
| 2b | **Xác nhận nguyên nhân — Claude dừng chờ bạn.** Trình bày nguyên nhân, bằng chứng, vị trí code, hướng sửa, phạm vi. Bạn hỏi lại, bổ sung, đổi hướng; chỉ khi bạn đồng ý rõ ràng mới sang bước 3 | |
| 3 | Bắt đầu code: tạo/checkout nhánh cho từng repo cần sửa, **ticket tự chuyển sang In Progress** | `git_start_branch` |
| 4 | Sửa code trong phạm vi ticket, build kiểm tra. Comment ngắn gọn, **không ghi mã Jira** | |
| 5 | **Review độc lập** bằng subagent mới; sửa theo review; có sửa thì review lại (tối đa 2 vòng) | `git_review_diff` |
| 6 | Commit + push | `git_commit_push` |
| 7 | Tạo PR vào nhánh môi trường, **title = tên nhánh, mô tả trống**. Conflict → **dừng, báo bạn** | `bb_create_pull_requests` |
| 8 | Viết worklog `<worklogDir>/<KEY>.md`: nguyên nhân, cách xử lý, repo/nhánh, link PR, việc tiếp theo (không commit). Chưa cấu hình `worklogDir` → hỏi bạn | |
| 9 | Báo lại: nguyên nhân, file sửa, kết quả review, nhánh, link PR, đường dẫn worklog, việc bạn cần làm | |

**Sau lệnh này bạn cần:** review lại diff/PR, xử lý conflict nếu có, chờ PR merged rồi chạy `kiem-tra-build`.

---

### 3.3 `/mcp__sds-dev__review-code <KEY> [repos]`

**Dùng khi:** muốn review riêng code của một ticket (code bạn tự viết, hoặc code Claude viết ở phiên khác).

**Tham số:**
- `key` – mã Jira.
- `repos` (tùy chọn) – vd `200133ebwebbe,200133ebwebfe`. Bỏ trống thì Claude tự tìm repo đang ở nhánh của ticket.

**Claude làm:**
1. Tạo **một subagent mới**, không mang theo phân tích của phiên hiện tại.
2. Subagent tự đọc ticket trên Jira, tự lấy diff, tự đọc code xung quanh, rồi trả danh sách vấn đề: mức độ | file:dòng | vấn đề | tình huống gây lỗi | cách sửa.
3. Claude trình bày từng vấn đề, nói đồng ý hay không và vì sao, rồi **hỏi bạn có sửa không**. Lệnh này không tự sửa.

Chi tiết ở [mục 6](#6-review-code-độc-lập).

---

### 3.4 `/mcp__sds-dev__kiem-tra-build <KEY> [env]`

**Dùng khi:** PR đã merged, muốn biết code đã lên server test chưa.

**Tham số:**
- `key` – mã Jira.
- `env` (tùy chọn) – nhánh môi trường, vd `dev-99`. Bỏ trống = mọi nhánh trong `prTargets`.

**Claude làm:**
1. Tìm repo có nhánh của ticket.
2. `bb_pull_request_status`: PR nào OPEN / MERGED / conflict.
3. `build_check` cho từng PR đã MERGED.
4. Báo bảng repo | nhánh đích | PR | build.
5. Tất cả đã build → **hỏi bạn** có chuyển ticket sang In Review không.

---

## 4. Nói chuyện bình thường với Claude

Không cần nhớ lệnh tắt, Claude tự chọn tool. Câu mẫu:

**Jira**
- "Hôm nay tôi có việc gì?"
- "Các ticket đang In Review của tôi"
- "Tất cả ticket chưa đóng của tôi"
- "Đọc ticket EBW-67919"
- "Tester comment gì ở EB133-6806?"
- "Bắt đầu làm EBW-67919" → chuyển In Progress
- "Chuyển EBW-67919 sang In Review" → Claude hỏi lại trước khi chuyển
- "Ghi comment vào EBW-67919: đã sửa sắp xếp theo OrderPriority" → Claude hỏi lại trước khi ghi
- "Tìm ticket có chữ 'Đẩy lại hóa đơn' trong project EBW" → JQL tùy ý

**Git / Bitbucket**
- "Tạo nhánh fixbug cho EBW-67919 ở webbe và webfe"
- "Commit và push"
- "Tạo PR cho nhánh hiện tại"
- "Lần này chỉ tạo PR vào dev-99"
- "PR của EBW-67919 có bị conflict không?"

**Build**
- "EBW-67919 build lên dev-99 chưa?"
- "Kiểm tra build cho nhánh fixbug/minhpm/EBW-67919 trên dev-99-mix-200"

**Database (chỉ đọc)**
- "Bảng RepositoryLedger trên gr2 có những index nào?"
- "Tìm proc có chữ TON_KHO trên gr1"
- "Cho tôi xem mã nguồn Proc_TONG_HOP_TON_KHO trên gr2"
- "Chứng từ SAInvoice số HD0001 của công ty X trên gr2 đã ghi sổ chưa?"

**Review**
- "Review code EBW-67919"
- "Review thay đổi trong repo 200133ebwebbe"

---

## 5. Danh sách tool chi tiết

Ký hiệu cột "Tự động": **Có** = Claude gọi không cần hỏi; **Hỏi** = Claude phải hỏi bạn trước.

### 5.1 Cấu hình

#### `config_show`
| | |
|---|---|
| Làm gì | Hiện file cấu hình đang dùng, Jira/Bitbucket đã có token chưa, danh sách repo, `prTargets`, `worklogDir`, DB, `blockedDbHosts`. Không hiện giá trị token/mật khẩu |
| Tham số | không |
| Tự động | Có |
| Ví dụ | "gọi config_show" |

### 5.2 Jira

#### `jira_search`
| | |
|---|---|
| Làm gì | Tìm ticket của bạn |
| Tham số | `scope`: `work` (mặc định: To do + In Progress + Reopened), `review` (In Review), `all` (mọi ticket chưa đóng). `jql`: JQL tùy ý, ghi đè `scope`. `maxResults`: 1–100, mặc định 50 |
| Kết quả | `jql` đã dùng, `total`, `byStatus` (đếm theo trạng thái), `issues` (mã, loại, trạng thái, ưu tiên, tóm tắt, cập nhật) |
| Tự động | Có |
| Ví dụ | "Hôm nay tôi có việc gì?" · "Ticket In Review của tôi" · "Tìm ticket project = EB133 AND text ~ 'CCCD'" |

#### `jira_get_issue`
| | |
|---|---|
| Làm gì | Đọc chi tiết một ticket |
| Tham số | `key` |
| Kết quả | Tiêu đề, loại, trạng thái, ưu tiên, người giao/nhận, môi trường, components, labels, mô tả, custom field có giá trị (theo tên hiển thị), file đính kèm, ticket liên kết, sub-task, 10 comment gần nhất |
| Tự động | Có |

#### `jira_start_work`
| | |
|---|---|
| Làm gì | Chuyển riêng ticket **To do / Reopened → In Progress** (thường không cần gọi, vì `git_start_branch` đã tự làm). Đã In Progress thì giữ nguyên. Trạng thái khác (In Review, Done Test…) **không** tự chuyển, trả về để Claude hỏi bạn |
| Tham số | `key` |
| Kết quả | `changed`, `from`, `status`, `wasReopened` |
| Tự động | Có |

#### `jira_list_transitions`
| | |
|---|---|
| Làm gì | Các bước chuyển trạng thái hợp lệ của ticket ở trạng thái hiện tại |
| Tham số | `key` |
| Tự động | Có |

#### `jira_transition`
| | |
|---|---|
| Làm gì | Chuyển trạng thái theo tên bước chuyển hoặc tên trạng thái đích, vd `In Review` |
| Tham số | `key`, `to` |
| Tự động | **Hỏi** |

#### `jira_add_comment`
| | |
|---|---|
| Làm gì | Thêm comment vào ticket (vd ghi nguyên nhân, cách sửa, nhánh, PR) |
| Tham số | `key`, `body` (wiki markup của Jira) |
| Tự động | **Hỏi** |

### 5.3 Git

Tham số `repo` của các tool git/Bitbucket/build: tên repo trong cấu hình (vd `200133ebwebbe`) hoặc đường dẫn tuyệt đối tới thư mục repo.

#### `git_start_branch`
| | |
|---|---|
| Làm gì | Bắt đầu code ticket: tạo hoặc checkout nhánh `<kind>/<user>/<KEY>` (nhánh mới tạo từ nhánh gốc, mặc định `prod`, sau khi `pull`; nhánh đã có thì checkout lại), **đồng thời chuyển ticket To do/Reopened sang In Progress** |
| Kết quả | Thông tin nhánh + trường `jira` (đã chuyển / giữ nguyên / lỗi). Lỗi Jira không chặn việc tạo nhánh, Claude sẽ báo bạn |
| Tham số | `repo`, `issueKey`, `kind`: `fixbug` / `task` / `features`, `base` (tùy chọn) |
| Chặn | Từ chối nếu repo có thay đổi chưa commit và đang ở nhánh khác |
| Tự động | Có |

#### `git_review_diff`
| | |
|---|---|
| Làm gì | Lấy toàn bộ thay đổi của nhánh so với nhánh gốc (tính từ merge-base, gồm cả phần chưa commit) và danh sách file mới. Dùng cho reviewer |
| Tham số | `repo`, `base` (tùy chọn) |
| Kết quả | `branch`, `mergeBase`, `stat`, `diff` (tối đa 200.000 ký tự), `untrackedFiles` |
| Tự động | Có |

#### `git_commit_push`
| | |
|---|---|
| Làm gì | Commit trên nhánh task hiện tại rồi push |
| Commit message | **Luôn đúng bằng tên nhánh**, không thêm dòng nào khác (không có `Co-Authored-By: Claude`). Tool không nhận tham số message |
| Tham số | `repo`, `files` (tùy chọn: danh sách file cần add, **bắt buộc với file mới**) |
| Mặc định | `git add -u`: chỉ file đã được git theo dõi. File mới không tự vào commit |
| Chặn | Từ chối trên mọi nhánh trong `protectedBranches` và mọi nhánh không đúng dạng `fixbug|task|features/<user>/<KEY>` |
| Kết quả | File đã commit, mã commit, `untrackedNotIncluded` (file mới chưa được add) |
| Tự động | Có (chỉ sau khi đã review) |

### 5.4 Bitbucket

#### `bb_create_pull_requests`
| | |
|---|---|
| Làm gì | Tạo PR từ nhánh task vào các nhánh môi trường. PR đã mở sẵn thì trả lại PR cũ |
| Title, mô tả | Title **luôn là tên nhánh**, vd `fixbug/minhpm/EBW-67919`; mô tả **luôn để trống**. Tool không nhận title hay description, nên Claude không tự sinh nội dung hay thêm dòng "Generated with Claude Code" |
| Tham số | `repo`, `targets` (tùy chọn, mặc định `prTargets` của repo), `sourceBranch` (mặc định nhánh hiện tại) |
| Kết quả | Mỗi nhánh đích: `created` / `already-open` / `error`, số PR, link |
| Chặn | Từ chối nếu nhánh nguồn là nhánh môi trường |
| Tự động | Có |

#### `bb_pull_request_status`
| | |
|---|---|
| Làm gì | Các PR của nhánh: OPEN / MERGED / DECLINED; với PR đang mở: `canMerge`, `conflicted`, lý do chặn merge |
| Tham số | `repo`, `sourceBranch` (tùy chọn) |
| Tự động | Có |
| Lưu ý | `conflicted: true` → Claude dừng và báo bạn. **Không có tool merge hay resolve conflict** |

### 5.5 Build

#### `build_check`
| | |
|---|---|
| Làm gì | Tìm commit **có tích xanh mới nhất** của nhánh môi trường trên Gitea mirror, rồi kiểm tra bằng git commit của bạn có nằm **dưới** nó không |
| Tham số | `repo`, `targetBranch` (vd `dev-99`), `sourceBranch` hoặc `issueKey` (tùy chọn, mặc định nhánh hiện tại) |
| Kết quả | `verdict`, commit tích xanh mới nhất, trạng thái các commit gần đây, thời điểm Gitea đồng bộ, link trang Gitea |
| Tự động | Có |

| `verdict` | Ý nghĩa |
|---|---|
| ĐÃ BUILD | Đã lên môi trường |
| ĐANG CHỜ BUILD | Đã merge nhưng chưa build, hoặc Gitea mirror chưa đồng bộ |
| CHƯA MERGE | Commit chưa có trong nhánh môi trường |
| CHƯA THẤY TÍCH XANH | 60 commit gần nhất không có tích xanh |

### 5.6 Database (chỉ SELECT)

Tham số `db`: tên DB trong cấu hình. Hiện có `routing` (EB_ROUTING), `gr1` (EB99_GR1), `gr2` (EB99_GR2), `88` (EB88), `88_2` (EB88_2).

#### `db_list`
Liệt kê DB đã cấu hình: tên, server, database, user, ghi chú. Không hiện mật khẩu.

#### `db_query`
| | |
|---|---|
| Làm gì | Chạy **1 câu** `SELECT` hoặc `WITH … SELECT` |
| Tham số | `db`, `sql`, `maxRows` (mặc định 200, tối đa 2000) |
| Kết quả | `columns`, `rows`, `rowCount`, `truncated`, `ms` |
| Chặn | Mọi câu ghi, DDL, `EXEC`, `SELECT INTO`, `sp_`/`xp_`, nhiều câu lệnh. Chạy trong transaction luôn rollback; khóa tối đa 10 giây, timeout 30 giây |

#### `db_describe_table`
Cột, kiểu, null, default, index (cột khóa + include + filter), CHECK constraint, khóa ngoại, số dòng ước tính. Tham số: `db`, `table`.

#### `db_find`
Tìm bảng, view, proc, function, trigger và cột có tên chứa từ khóa. Tham số: `db`, `keyword`.

#### `db_source`
Mã nguồn hiện tại trên DB của proc/function/view/trigger (chỉ đọc, không chạy). Tham số: `db`, `name`.

---

## 6. Review code độc lập

### Vì sao

Phiên đã viết code thường "tự làm tự coi là đúng": nó nhớ lý do sửa nên dễ bỏ qua chính lỗi của mình. Vì vậy review **không** do phiên đó làm.

### Cách làm

- Claude tạo một **subagent mới** (không fork, không mang lịch sử phiên).
- Subagent **không** nhận phân tích, nguyên nhân hay lý do sửa. Nó chỉ biết mã ticket và repo.
- Subagent tự đọc yêu cầu từ Jira, tự lấy diff bằng `git_review_diff`, tự đọc code xung quanh, được dùng `db_*` để kiểm tra dữ liệu.
- Subagent **không được** sửa file, commit, push hay đổi trạng thái Jira.

### Reviewer kiểm tra gì

| Nhóm | Nội dung |
|---|---|
| Đúng yêu cầu | Làm đủ chưa, có làm thừa ngoài phạm vi, có đổi logic cũ không cần thiết |
| Lỗi logic | null, `Optional.get()`, `get(0)`, sai điều kiện, so sánh String với UUID, trường hợp biên, dữ liệu rỗng, nhiều công ty/nhiều năm |
| Ảnh hưởng | Hàm dùng chung bị đổi hành vi, nơi gọi khác, repo khác cần sửa theo (coremodel ↔ be ↔ queue ↔ fe) |
| Quy ước dự án | `BadRequestAlertException` + errorKey; không để `catch(Exception)` nuốt lỗi; giữ `YearContextHolder`/`SecurityContext` khi sang thread khác; không `stream().filter()` trong vòng lặp; không tạo formatter trong vòng lặp; giới hạn phải ném lỗi ngay; không dùng `List<Object[]>` |
| SQL/proc | Lọc theo công ty, index, quét bảng lớn |
| Comment | Ngắn gọn, xúc tích; **không chứa mã Jira**; không để code bị comment bỏ hay comment diễn giải lại code |
| File | File rác, file test, cấu hình cá nhân lẫn vào |

### Kết quả

Mỗi vấn đề: **NGHIÊM TRỌNG / NÊN SỬA / GÓP Ý** | file:dòng | vấn đề | tình huống gây lỗi | cách sửa.

- Trong `lam-task`: Claude sửa vấn đề đúng, ghi lý do với vấn đề không đồng ý, có sửa thì review lại bằng subagent mới khác (tối đa 2 vòng), rồi mới commit.
- Trong `review-code`: Claude chỉ trình bày và hỏi bạn, không tự sửa.

---

## 7. Đọc database

**Chỉ đọc.** Cần sửa hoặc tạo dữ liệu để test, Claude sẽ viết câu SQL ra để **bạn tự chạy**.

Nên hỏi kèm DB và công ty để truy vấn nhanh, ví dụ: "trên gr2, công ty MST 0319587336, chứng từ …".

Các lớp bảo vệ:
1. Chỉ 1 câu `SELECT`/`WITH`, chặn mọi từ khóa ghi và nguy hiểm (sau khi bỏ comment và chuỗi).
2. Transaction luôn rollback.
3. Kết nối chế độ chỉ đọc, khóa ≤ 10 giây, timeout 30 giây, tối đa 2000 dòng.
4. Không kết nối IP trong `blockedDbHosts` (DB production).
5. Nên dùng login chỉ có quyền `db_datareader` (xin DBA).

Kiểm tra bộ chặn: `node scripts/test-guard.mjs`.

---

## 8. Việc Claude tự làm và việc phải hỏi

**Quy tắc viết code:** sửa trong phạm vi ticket, thay đổi tối thiểu; comment ngắn gọn, xúc tích, chỉ khi cần giải thích lý do; **không ghi mã Jira vào comment** (mã ticket đã nằm trong tên nhánh và commit).


| Tự làm | Phải hỏi bạn | Không bao giờ làm |
|---|---|---|
| Đọc/tìm ticket | **Xác nhận nguyên nhân trước khi sửa code** | Merge PR |
| Điều tra nguyên nhân (đọc code, SELECT DB) | Chuyển ticket sang In Review hoặc trạng thái khác | Tạo nhánh/sửa code khi bạn chưa xác nhận nguyên nhân |
| Chuyển To do/Reopened → In Progress khi bắt đầu code (tạo nhánh) | Ghi comment Jira | Resolve conflict trên nhánh môi trường |
| Tạo/checkout nhánh task | Yêu cầu ticket mơ hồ | Commit/push vào nhánh môi trường (`protectedBranches`) |
| Review độc lập | Sửa theo kết quả `review-code` | Ghi/sửa/xóa dữ liệu DB, chạy proc |
| Commit + push nhánh task | | Kết nối DB production |
| Tạo PR vào `prTargets` | | |
| Viết/cập nhật worklog trong `worklogDir` | | Commit file worklog |
| Kiểm tra PR, build | | |
| Đọc DB (SELECT) | | |

---

## 9. Một ngày làm việc mẫu

```
08:30  /mcp__sds-dev__viec-cua-toi
       → Reopened: không có | In Progress: không có | To do: EBW-67919 (Medium), EB133-6806 (Low)
       → Gợi ý: làm EBW-67919 trước (ưu tiên cao hơn, mới cập nhật)

08:35  /mcp__sds-dev__lam-task EBW-67919
       → Đọc ticket
       → Nguyên nhân: ... (file:dòng, bằng chứng), hướng sửa dự kiến → DỪNG chờ bạn
       Bạn: "sao không sửa ở FE?"  → Claude giải thích, kiểm tra thêm
       Bạn: "ok, sửa đi"
       → Tạo fixbug/minhpm/EBW-67919 ở 200133ebwebbe, ticket sang In Progress
       → Sửa, build OK
       → Review độc lập: 1 NÊN SỬA (thiếu kiểm tra list rỗng) → đã sửa → review lại: không còn lỗi
       → Commit, push, PR #7310 → dev-99-mix-200, PR #7311 → dev-99
       → Ghi worklog <worklogDir>/EBW-67919.md

09:30  Bạn xem PR trên Bitbucket. PR #7311 conflict → bạn tự xử lý trên dev-99.

11:00  /mcp__sds-dev__kiem-tra-build EBW-67919
       → dev-99-mix-200: ĐÃ BUILD | dev-99: ĐANG CHỜ BUILD

11:40  "EBW-67919 build lên dev-99 chưa?"  → ĐÃ BUILD
       → "Chuyển EBW-67919 sang In Review?"  → bạn: "ok"  → đã chuyển

14:00  Tester chuyển EBW-67919 sang Reopened
       /mcp__sds-dev__lam-task EBW-67919
       → Đọc comment tester, checkout lại nhánh cũ (ticket sang In Progress), sửa đúng phần tester nêu
```

---

## 10. Câu hỏi thường gặp và xử lý lỗi

**Lệnh `/mcp__sds-dev__...` không hiện?**
Tắt hẳn app Claude (cả biểu tượng ở khay hệ thống) rồi mở lại, tạo phiên mới.

**Muốn Claude chỉ phân tích, chưa sửa?**
Nói rõ: "Đọc EBW-67919, tìm nguyên nhân, chưa sửa code".

**Muốn sửa xong nhưng chưa commit?**
Nói rõ: "Làm EBW-67919 nhưng dừng trước khi commit".

**Ticket cần sửa nhiều repo?**
`lam-task` tạo nhánh cùng tên ở từng repo, review cả các repo, tạo PR cho từng repo theo `prTargets` riêng.

**PR cần vào nhánh khác lần này?**
"Tạo PR cho EBW-67919 chỉ vào dev-99". Muốn đổi lâu dài thì sửa `prTargets` trong `config.local.json`.

| Lỗi | Cách xử lý |
|---|---|
| `Chưa cấu hình ...` | Điền giá trị còn thiếu trong `config.local.json` |
| `HTTP 401` | Token hết hạn hoặc sai → tạo lại |
| `HTTP 403` khi tạo PR | Token Bitbucket thiếu quyền Repository write |
| `Ticket ... không có bước chuyển "..."` | Tên trạng thái khác cấu hình → sửa `jira.statuses` |
| `Nhánh "..." là nhánh môi trường được bảo vệ` | Đúng thiết kế, tạo nhánh task trước |
| `Repo ... có thay đổi chưa commit` | Commit hoặc stash thay đổi đang dở rồi chạy lại |
| `git ... could not read Username` | Chạy `git fetch` tay một lần trong repo để lưu đăng nhập |
| `Câu lệnh chứa "..." không được phép` | Đúng thiết kế: DB chỉ SELECT |
| `Login failed` / `Failed to connect` | Sai thông tin DB hoặc không vào được mạng nội bộ |
| `build_check` mãi ĐANG CHỜ BUILD | Gitea mirror chưa đồng bộ, đợi rồi thử lại hoặc mở `giteaUrl` |
