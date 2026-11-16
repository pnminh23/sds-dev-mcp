# sds-dev-mcp

MCP cho Claude Code, gom quy trình làm một ticket Jira của dev EasyBooks thành các lệnh Claude tự gọi:

```
Đọc ticket Jira → tìm nguyên nhân → XÁC NHẬN NGUYÊN NHÂN (Claude dừng, bạn trao đổi/đồng ý)
   → tạo nhánh → sửa code → review độc lập → commit + push → tạo PR vào nhánh môi trường
   → ghi worklog → (conflict: bạn tự xử lý) → merged → kiểm tra đã build chưa → chuyển Jira sang In Review
```

Bạn chỉ cần nói "làm ticket EB133-6666" hoặc "EB133-6666 build lên dev-99 chưa", Claude sẽ tự đọc Jira, thao tác git, Bitbucket, Gitea.
Claude **không sửa code trước khi bạn xác nhận nguyên nhân**: sau khi điều tra, Claude trình bày nguyên nhân, bằng chứng, vị trí code, hướng sửa rồi dừng chờ bạn hỏi lại, bổ sung hoặc đồng ý.

**Hướng dẫn sử dụng chi tiết (lệnh tắt, từng tool, câu hỏi mẫu, review độc lập): [docs/HUONG-DAN-SU-DUNG.md](docs/HUONG-DAN-SU-DUNG.md).** README này tập trung vào cài đặt và cấu hình.

---

## Mục lục

1. [Yêu cầu](#1-yêu-cầu)
2. [Cài đặt](#2-cài-đặt)
3. [Cấu hình](#3-cấu-hình)
4. [Sử dụng hằng ngày](#4-sử-dụng-hằng-ngày)
5. [Danh sách tool](#5-danh-sách-tool)
6. [Quy tắc an toàn](#6-quy-tắc-an-toàn)
7. [Chia sẻ cho người khác](#7-chia-sẻ-cho-người-khác)
8. [Xử lý lỗi](#8-xử-lý-lỗi)
9. [Phát triển thêm](#9-phát-triển-thêm)

---

## 1. Yêu cầu

| Cần có | Kiểm tra |
|---|---|
| Node.js 20 trở lên | `node --version` |
| Git, đã đăng nhập được Bitbucket công ty (đã từng `git fetch` thành công) | `git fetch` trong một repo |
| Claude Code (app desktop hoặc CLI) | |
| Tài khoản Jira và Bitbucket công ty | |
| Các repo đã clone về chung một thư mục, vd `C:/PNMINH/sds/200133ebwebbe` | |

Gitea mirror (`http://10.100.120.190:30089`) chỉ dùng để xem, **không cần tài khoản**.

---

## 2. Cài đặt

### Bước 1: Lấy code về máy

Đặt thư mục `sds-dev-mcp` cạnh các repo, vd `C:/PNMINH/sds/sds-dev-mcp`. Cách lấy code: xem [mục 7](#7-chia-sẻ-cho-người-khác).

### Bước 2: Cài thư viện, build, đăng ký với Claude

```bash
cd C:/PNMINH/sds/sds-dev-mcp
npm install
npm run setup
```

`npm run setup` sẽ:
- build code ra `dist/`
- tạo `config.local.json` từ `config.example.json` nếu chưa có
- đăng ký MCP tên `sds-dev` vào `~/.claude.json` (phạm vi user, dùng được ở mọi thư mục), sao lưu bản cũ thành `~/.claude.json.bak-sds-dev`

### Bước 3: Tạo token (tự làm trên web, không dán token vào chat với Claude)

**Jira**: ảnh đại diện (góc phải trên) → **Profile** → **Personal Access Tokens** → **Create token**. Đặt tên `claude-mcp`, chọn hạn dùng, copy token.

**Bitbucket** (`https://git-sds.softdreams.vn:7990`): ảnh đại diện → **Manage account** → **HTTP access tokens** → **Create token**. Quyền:
- Project permissions: **Project read**
- Repository permissions: **Repository write** (cần để tạo PR)

### Bước 4: Điền `config.local.json`

Mở file và thay mọi giá trị bắt đầu bằng `DAN_` (xem [mục 3](#3-cấu-hình)). Tối thiểu cần:

```json
"jira":      { "url": "https://<địa chỉ jira>", "token": "<token jira>" },
"bitbucket": { "url": "https://git-sds.softdreams.vn:7990", "token": "<token bitbucket>" },
"git":       { "user": "<tên bạn trong tên nhánh, vd minhpm>", ... },
"reposRoot": "<thư mục chứa các repo, vd C:/PNMINH/sds>",
```

File này nằm trong `.gitignore`, không bị commit. File được đọc lại ở mỗi lần gọi tool, sửa xong dùng được ngay.

### Bước 5: Khởi động lại Claude và kiểm tra

1. **Tắt hẳn** app Claude (hoặc CLI) rồi mở lại.
2. Mở phiên mới ở bất kỳ repo nào, gõ: `gọi config_show`
3. Lần đầu app hỏi quyền dùng tool → chọn cho phép.
4. Kết quả đúng: `tokenConfigured: true` cho cả `jira` và `bitbucket`, `git.user` là tên bạn.

---

## 3. Cấu hình

| Trường | Ý nghĩa | Ví dụ |
|---|---|---|
| `jira.url` | Địa chỉ Jira công ty | `https://jira.congty.vn` |
| `jira.token` | Personal Access Token Jira | |
| `jira.projectKeys` | Tiền tố mã Jira của team. Sensor chỉ coi các tiền tố này (và tiền tố của nhánh hiện tại) là mã Jira, tránh báo nhầm `UTF-8`, `PL01-1`... | `["EBW", "EB133", "EB88"]` |
| `jira.statuses` | Tên trạng thái Jira của team, chỉ cần khi khác mặc định | xem [Trạng thái Jira](#trạng-thái-jira) |
| `bitbucket.url` | Địa chỉ Bitbucket Server | `https://git-sds.softdreams.vn:7990` |
| `bitbucket.token` | HTTP access token Bitbucket | |
| `gitea.url`, `gitea.owner` | Gitea mirror để xem tích xanh build | `http://10.100.120.190:30089`, `admin` |
| `git.user` | Tên của bạn trong tên nhánh `fixbug/<user>/<KEY>` | `minhpm` |
| `git.baseBranch` | Nhánh gốc để tạo nhánh task | `prod` |
| `git.protectedBranches` | Nhánh môi trường: **không bao giờ** commit/push tự động vào | `prod`, `test`, `dev-99`... |
| `reposRoot` | Thư mục chứa các repo | `C:/PNMINH/sds` |
| `worklogDir` | Thư mục lưu worklog `<KEY>.md`: tạo khi bắt đầu code, MCP tự ghi các mốc (nhánh, commit, PR, build, Jira), dùng làm checkpoint khi mở phiên mới. Bỏ trống thì Claude hỏi khi cần | `C:/PNMINH/worklog` |
| `logDir` | Thư mục nhật ký gọi tool (`YYYY-MM.jsonl`). Mặc định `<thư mục MCP>/logs` | |
| `repos.<tên>.prTargets` | Nhánh môi trường cần tạo PR vào | `["test", "dev-99"]` |
| `repos.<tên>.giteaRepo` | Tên repo trên Gitea nếu khác Bitbucket | `88ebweb` → `ebweb88` |
| `repos.<tên>.path` | Đường dẫn riêng nếu repo không nằm trong `reposRoot` | |
| `repos.<tên>.baseBranch` | Nhánh gốc riêng cho repo này | |
| `insecureTls` | `true` nếu server nội bộ dùng chứng chỉ tự ký | `false` |
| `databases.<tên>` | DB local/test để Claude **chỉ đọc**: `server`, `port`, `database`, `user`, `password`, `note` | xem [mục 4](#đọc-database-chỉ-select) |
| `blockedDbHosts` | Host DB không bao giờ được kết nối (điền IP DB production) | `["10.x.x.x"]` |

### Trạng thái Jira

| Khóa | Mặc định | Ý nghĩa | MCP làm gì |
|---|---|---|---|
| `todo` | `To do` | Tester giao, chưa làm | Hiện trong việc cần làm |
| `inProgress` | `In Progress` | Đang làm | Tự chuyển sang khi bắt đầu làm ticket |
| `reopened` | `Reopened` | Tester trả lại từ In Review vì chưa đúng | Hiện đầu danh sách; đọc comment tester, làm tiếp trên nhánh cũ |
| `inReview` | `In Review` | Đã build, chờ tester | Chỉ chuyển sang khi bạn đồng ý |
| `done` | `Done Test` | Tester xác nhận xong | |

**Việc cần làm = To do + In Progress + Reopened.** Ticket In Review, Reject, Done Test không hiện trong danh sách mặc định.

Team dùng tên khác thì khai báo trong `config.local.json`, chỉ cần các khóa khác mặc định:

```json
"jira": { "url": "...", "token": "...", "statuses": { "todo": "ToDo Dev", "inReview": "InReview" } }
```

**`prTargets` khác nhau theo project.** Hỏi leader và điền đúng cho từng repo trước khi dùng.

---

## 4. Sử dụng hằng ngày

### Cách 1: Lệnh tắt

Trong Claude Code gõ `/` rồi tìm `sds-dev`:

| Lệnh | Làm gì |
|---|---|
| `/mcp__sds-dev__viec-cua-toi` | Việc cần làm theo nhóm Reopened → In Progress → To do, gợi ý làm gì tiếp |
| `/mcp__sds-dev__lam-task EB133-6666` | Đọc worklog nếu đang làm dở → đọc ticket → tìm nguyên nhân → **dừng để bạn xác nhận nguyên nhân** → tạo nhánh (tự chuyển In Progress, tạo worklog) → sửa → **sensor + review độc lập** → commit, push → tạo PR → hoàn thiện worklog → báo lại |
| `/mcp__sds-dev__review-code EB133-6666` | Subagent mới (không phải phiên viết code) review thay đổi của ticket, báo vấn đề để bạn quyết định |
| `/mcp__sds-dev__kiem-tra-build EB133-6666 dev-99` | PR merged chưa, build lên dev-99 chưa; xong thì hỏi chuyển In Review |

### Cách 2: Nói bình thường

Claude tự chọn tool phù hợp:

- "Hôm nay tôi có việc gì trên Jira?"
- "Đọc ticket EBW-67884, lỗi nằm ở repo nào?"
- "Tạo nhánh fixbug cho EBW-67884 ở webbe"
- "Commit và push rồi tạo PR"
- "PR của EBW-67884 có bị conflict không?"
- "EBW-67884 đã build lên dev-99 chưa?"
- "Chuyển EBW-67884 sang In Review"

### Ví dụ một ticket từ đầu đến cuối

```
Bạn:    /mcp__sds-dev__lam-task EB133-6666
Claude: [jira_get_issue] Bug màn chi tiết, môi trường app133.
        Nguyên nhân: ... ở 200133ebwebbe/.../XServiceImpl.java:123 (bằng chứng ...)
        Hướng sửa: ... Bạn xác nhận nguyên nhân này chưa?
Bạn:    dữ liệu cũ có bị ảnh hưởng không?
Claude: [db_query] ... không ảnh hưởng vì ...
Bạn:    ok, sửa đi
Claude: [git_start_branch] Tạo fixbug/minhpm/EB133-6666 từ prod (kèm nguyên nhân bạn vừa đồng ý),
        tạo worklog <worklogDir>/EB133-6666.md
        [sửa code, build kiểm tra]
        [git_review_diff] Sensor: 0 LỖI. Review độc lập: không còn lỗi
        [git_commit_push] Commit "fixbug/minhpm/EB133-6666", đã push
        [bb_create_pull_requests] PR #7301 → test, PR #7302 → dev-99
        Worklog đã có nhật ký nhánh/commit/PR; Claude viết thêm cách xử lý

-- PR dev-99 bị conflict --
Claude: PR #7302 vào dev-99 bị conflict. Bạn tự xử lý trên dev-99.
Bạn:    (tự checkout dev-99, pull nhánh, sửa conflict, push)

-- Sau khi PR merged --
Bạn:    /mcp__sds-dev__kiem-tra-build EB133-6666
Claude: test: ĐÃ BUILD | dev-99: ĐANG CHỜ BUILD
        ... (lát sau hỏi lại)
Claude: Cả hai đã build. Chuyển EB133-6666 sang In Review?
Bạn:    ok
Claude: [jira_transition] Đã chuyển sang In Review.
```

### Đọc database (chỉ SELECT)

Khi sửa bug cần xem dữ liệu thật, Claude có thể truy vấn DB local/test. **Chỉ được SELECT**, không ghi, không tạo, không chạy proc.

**Cấu hình** trong `config.local.json`, mỗi DB một khóa (tên ngắn tùy đặt):

```json
"databases": {
  "test1": {
    "server": "<IP DB test>",
    "port": 1433,
    "database": "<tên database>",
    "user": "<login chỉ đọc>",
    "password": "<mật khẩu>",
    "note": "DB local/test nhóm 1"
  }
},
"blockedDbHosts": ["<IP DB production>"]
```

**Nên xin DBA một login chỉ có quyền `db_datareader`** (thêm `VIEW DEFINITION` nếu muốn xem mã nguồn proc). Đây là lớp bảo vệ chắc chắn nhất; các lớp trong code chỉ là phòng thêm.

**Cách hỏi Claude:**
- "Bảng RepositoryLedger có những cột và index nào?"
- "Xem dữ liệu sổ kho của chứng từ có RefID ... trên test1"
- "Tìm proc có chữ TON_KHO, cho tôi xem mã nguồn"
- "Chứng từ SAInvoice số ... đã ghi sổ chưa, GL có mấy dòng?"

Cần sửa hoặc tạo dữ liệu để test thì Claude sẽ viết câu SQL ra để bạn tự chạy.

**Các lớp chặn trong code:**
1. Chỉ cho 1 câu bắt đầu bằng `SELECT` hoặc `WITH`. Chặn mọi từ khóa ghi, DDL và nguy hiểm (`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `EXEC`, `INTO`, `OPENROWSET`, `WAITFOR`, `sp_`, `xp_`...), sau khi đã bỏ comment và chuỗi để không bị lừa.
2. Câu lệnh chạy trong transaction và **luôn ROLLBACK**.
3. Kết nối với `ApplicationIntent=ReadOnly`, khóa tối đa 10 giây, timeout 30 giây, tối đa 200 dòng (tối đa 2000 nếu yêu cầu).
4. Không kết nối host trong `blockedDbHosts`.

Kiểm tra bộ chặn: `node scripts/test-guard.mjs`.

### `build_check` hoạt động thế nào

Giống cách xem tay trên trang Gitea: tìm commit **mới nhất có tích xanh** trên nhánh môi trường, rồi kiểm tra commit của bạn có nằm **dưới** nó không. Việc kiểm tra dùng `git merge-base --is-ancestor`, không dựa vào thứ tự hiển thị trên trang. Kết quả:

| Kết quả | Ý nghĩa |
|---|---|
| ĐÃ BUILD | Commit của bạn đã nằm dưới commit tích xanh mới nhất |
| ĐANG CHỜ BUILD | Đã merge nhưng chưa build, hoặc Gitea mirror chưa đồng bộ |
| CHƯA MERGE | Commit chưa có trong nhánh môi trường |
| CHƯA THẤY TÍCH XANH | 60 commit gần nhất không có tích xanh nào |

Gitea là bản mirror đồng bộ theo chu kỳ, có thể trễ vài chục phút so với Bitbucket.

---

## 5. Danh sách tool

| Tool | Làm gì | Claude tự làm? |
|---|---|---|
| `config_show` | Xem cấu hình, token nào đã có (không hiện giá trị token) | Có |
| `jira_get_issue` | Đọc ticket: mô tả, môi trường, custom field, đính kèm, 10 comment gần nhất | Có |
| `jira_search` | Việc của bạn. Mặc định: To do + In Progress + Reopened. `scope=review`: đang In Review. `scope=all`: mọi ticket chưa đóng | Có |
| `jira_start_work` | Bắt đầu làm: chuyển To do / Reopened → In Progress | Có |
| `jira_list_transitions` | Các bước chuyển trạng thái hợp lệ | Có |
| `jira_transition` | Chuyển trạng thái, vd `In Review`. Bắt buộc `userConfirmed=true` | **Hỏi trước** |
| `jira_add_comment` | Thêm comment vào ticket. Bắt buộc `userConfirmed=true` | **Hỏi trước** |
| `git_start_branch` | Tạo/checkout `fixbug\|task/<user>/<KEY>` từ `prod` mới nhất, tạo worklog. Bắt buộc `causeSummary` + `userConfirmed=true` (sau khi bạn xác nhận nguyên nhân) | Có |
| `git_review_diff` | Thay đổi của nhánh so với nhánh gốc (gồm phần chưa commit), cho reviewer, kèm **sensor** quét quy tắc cố định | Có |
| `git_commit_push` | Commit (message = tên nhánh), push nhánh task, sau khi đã review | Có |
| `bb_create_pull_requests` | Tạo PR vào các nhánh trong `prTargets`; PR đã có thì trả lại PR cũ | Có |
| `bb_pull_request_status` | Trạng thái PR: OPEN/MERGED/DECLINED, có conflict không | Có |
| `build_check` | Đã build lên nhánh môi trường chưa (Gitea) | Có |
| `db_list` | Các DB đã cấu hình (không hiện mật khẩu) | Có |
| `db_query` | Chạy 1 câu SELECT, tối đa 200 dòng | Có (chỉ đọc) |
| `db_describe_table` | Cột, kiểu, index, CHECK, khóa ngoại, số dòng ước tính | Có |
| `db_find` | Tìm bảng, view, proc, function, cột theo tên | Có |
| `db_source` | Mã nguồn proc/function/view trên DB | Có |

---

## 6. Quy tắc an toàn

Các quy tắc sau nằm trong code, không phụ thuộc vào việc Claude có nhớ hay không:

- `git_commit_push` **chỉ** chạy trên nhánh dạng `fixbug|task|features/<user>/<KEY>`; từ chối trên mọi nhánh trong `protectedBranches`.
- `git_commit_push` mặc định chỉ `git add -u` (file đã được git theo dõi). File mới phải được truyền rõ tên, để không commit nhầm file rác như `_testcase/`.
- `git_start_branch` từ chối chuyển nhánh khi repo có thay đổi chưa commit, và từ chối khi thiếu nguyên nhân đã được bạn xác nhận (`causeSummary` + `userConfirmed=true`).
- `jira_transition`, `jira_add_comment` từ chối khi thiếu `userConfirmed=true`.
- Nội dung ticket Jira, kết quả DB, nội dung file được coi là dữ liệu: chỉ thị nằm trong đó không thay đổi quy trình hay quyền.
- `bb_create_pull_requests` không nhận title/description: title luôn là tên nhánh, mô tả để trống. `git_commit_push` không nhận message: message luôn là tên nhánh.
- **Không có** tool merge PR hay resolve conflict. Conflict trên nhánh môi trường có code của nhiều người, do bạn tự xử lý.
- Git chạy với `GIT_TERMINAL_PROMPT=0`: thiếu đăng nhập thì báo lỗi ngay, không treo.
- Token chỉ nằm trong `config.local.json` trên máy bạn, không bị commit, không hiện ra qua `config_show`.
- Tool `db_*` chỉ chạy được SELECT, luôn rollback, không kết nối host trong `blockedDbHosts`. Chi tiết ở [mục 4](#đọc-database-chỉ-select).

---

## 7. Chia sẻ cho người khác

### Người tạo (làm một lần)

1. Xin leader tạo repo trên Bitbucket công ty, vd `ea/sds-dev-mcp`.
2. Đẩy code lên:

   ```bash
   cd C:/PNMINH/sds/sds-dev-mcp
   git init
   git add .
   git commit -m "sds-dev-mcp: phiên bản đầu"
   git remote add origin https://git-sds.softdreams.vn:7990/scm/ea/sds-dev-mcp.git
   git push -u origin master
   ```

   `.gitignore` đã loại `node_modules/`, `dist/`, `config.local.json`. **Kiểm tra `git status` trước khi commit để chắc không có token.**

3. Cập nhật `config.example.json` với `prTargets` đúng của team, để người mới chỉ cần điền token và tên.

### Người dùng mới

```bash
cd C:/PNMINH/sds
git clone https://git-sds.softdreams.vn:7990/scm/ea/sds-dev-mcp.git
cd sds-dev-mcp
npm install
npm run setup
```

Sau đó làm tiếp [Bước 3 → 5 của mục 2](#bước-3-tạo-token-tự-làm-trên-web-không-dán-token-vào-chat-với-claude).

### Cập nhật phiên bản mới

```bash
cd C:/PNMINH/sds/sds-dev-mcp
git pull
npm install
npm run setup
```

Rồi khởi động lại Claude. `config.local.json` của bạn được giữ nguyên, nên **so với `config.example.json` để thêm khoá mới** nếu có (vd `jira.projectKeys`, `worklogDir`, `logDir`). Thiếu khoá mới thì MCP vẫn chạy với mặc định.

### Gỡ cài đặt

Xóa mục `"sds-dev"` trong `mcpServers` của `~/.claude.json`, khởi động lại Claude, xóa thư mục `sds-dev-mcp`, thu hồi 2 token trên Jira và Bitbucket.

---

## 8. Xử lý lỗi

| Hiện tượng | Nguyên nhân và cách sửa |
|---|---|
| Claude nói không có tool `config_show` | Chưa khởi động lại Claude, hoặc `~/.claude.json` lỗi JSON. Chạy lại `npm run setup` |
| `Chưa có file cấu hình ...` | Chạy `npm run setup` |
| `Chưa cấu hình jira.token` / `git.user` | Điền giá trị còn `DAN_...` trong `config.local.json` |
| `HTTP 401` | Token sai hoặc hết hạn, tạo lại token |
| `HTTP 403` khi tạo PR | Token Bitbucket thiếu quyền Repository write |
| `HTTP 404` từ Jira | Sai `jira.url` hoặc mã ticket không tồn tại |
| `self-signed certificate` / `unable to verify` | Đặt `insecureTls: true` |
| `git ... thất bại: ... could not read Username` | Git chưa lưu đăng nhập Bitbucket. Chạy `git fetch` tay một lần trong repo, đăng nhập khi được hỏi |
| `Không tìm thấy repo "..."` | Sai `reposRoot` hoặc repo chưa clone |
| `Nhánh "..." là nhánh môi trường được bảo vệ` | Đúng thiết kế. Tạo nhánh task trước bằng `git_start_branch` |
| `Login failed for user` | Sai user/mật khẩu DB, hoặc login chưa được cấp quyền vào database đó |
| `Failed to connect ... in 15000ms` | Sai IP/port DB, hoặc máy không vào được mạng nội bộ |
| `Câu lệnh chứa "..." không được phép` | Đúng thiết kế: DB chỉ SELECT |
| `build_check` luôn ĐANG CHỜ BUILD | Gitea mirror chưa đồng bộ; đợi rồi kiểm tra lại, hoặc mở link `giteaUrl` trong kết quả |
| `Input validation error ... causeSummary` / `userConfirmed` | Đúng thiết kế: Claude chưa có xác nhận của bạn. Trả lời Claude, Claude sẽ gọi lại |
| Sensor báo `jira-key-in-comment` nhầm | Kiểm tra `jira.projectKeys` chỉ chứa tiền tố Jira thật (`EBW`, `EB133`, `EB88`...) |
| Không thấy worklog | Chưa cấu hình `worklogDir`, hoặc chưa tới bước `git_start_branch` (worklog tạo ở bước đó) |

---

## 9. Phát triển thêm

```
src/
  index.ts      Đăng ký tool + lệnh tắt (prompts), hướng dẫn quy trình cho Claude
  config.ts     Đọc config.local.json, tìm đường dẫn repo
  http.ts       Gọi REST API (Bearer token, timeout 30s)
  jira.ts       Jira Server/Data Center REST API v2
  git.ts        Lệnh git: tạo nhánh, commit, push, kiểm tra tổ tiên
  bitbucket.ts  Bitbucket Server REST API 1.0: tạo PR, trạng thái PR
  gitea.ts      Kiểm tra build qua commit status trên Gitea mirror
  db.ts         Truy vấn SQL Server chỉ đọc + bộ chặn câu lệnh ghi
  sensors.ts    Sensor quét diff bằng quy tắc cố định
  worklog.ts    Tạo worklog và ghi nhật ký mốc của ticket
  audit.ts      Nhật ký gọi tool (JSONL)
scripts/
  setup.mjs     Tạo config + đăng ký vào ~/.claude.json
  smoke.mjs     Gọi thử 1 tool không cần Claude
  audit-report.mjs Tổng hợp nhật ký gọi tool
  test-guard.mjs Kiểm tra bộ chặn SQL chỉ đọc
```

### Sửa xong thì làm gì để áp dụng

| Sửa | Cần làm | Vì sao |
|---|---|---|
| `config.local.json` | Không cần, có hiệu lực ở lần gọi tool kế tiếp | MCP đọc lại file cấu hình mỗi lần gọi tool |
| `src/*.ts` (tool, lệnh tắt, hướng dẫn quy trình) | `npm run build` → **tắt hẳn** Claude → mở lại → tạo **phiên mới** | Claude chạy `dist/index.js`; tiến trình MCP chỉ khởi động lại cùng Claude; phiên đang mở vẫn giữ hướng dẫn cũ |
| `README.md`, `docs/` | Không cần | Chỉ là tài liệu |
| Lần đầu cài, hoặc dời thư mục `sds-dev-mcp` | `npm run setup` → tắt hẳn Claude → mở lại | Đăng ký đường dẫn `dist/index.js` vào `~/.claude.json` |

"Tắt hẳn" = thoát cả biểu tượng ở khay hệ thống, không chỉ đóng cửa sổ. Sau khi mở lại, gõ `gọi config_show` để kiểm tra.

Chạy thử một tool không cần Claude (sau `npm run build`, dùng code mới ngay, không cần khởi động lại Claude):

```bash
npm run build
node scripts/smoke.mjs                       # liệt kê tool
node scripts/smoke.mjs config_show
node scripts/smoke.mjs build_check '{"repo":"200133ebwebbe","targetBranch":"dev-99","sourceBranch":"fixbug/minhpm/EBW-9999"}'
```

### Harness: sensor, ràng buộc, worklog, nhật ký, bài học

MCP áp dụng mô hình "Agent = Model + Harness": quy tắc quan trọng không chỉ nằm trong hướng dẫn mà được ép bằng code.

| Lớp | Ở đâu | Làm gì |
|---|---|---|
| Hướng dẫn | `INSTRUCTIONS`, prompt trong `src/index.ts` | Quy trình, giới hạn vòng lặp (3 lần thất bại thì dừng báo dev), đọc code tiết kiệm |
| Sensor | `src/sensors.ts` | Quét diff trong `git_review_diff`: mã Jira trong comment, `List<Object[]>`, debug output, conflict... |
| Ràng buộc tool | `src/index.ts` (zod schema) | `causeSummary` + `userConfirmed` cho `git_start_branch`; `userConfirmed` cho `jira_transition`/`jira_add_comment`; PR title/description cố định; nhánh bảo vệ; DB chỉ SELECT |
| Trạng thái | `src/worklog.ts` | Worklog tạo khi bắt đầu code; tự ghi mốc nhánh/sensor/commit/PR/build/Jira |
| Nhật ký | `src/audit.ts` | Mỗi lần gọi tool 1 dòng JSON trong `logs/YYYY-MM.jsonl`: không ghi token, câu SQL, nội dung comment, nguyên nhân. Lỗi của tool không phải `db_*` ghi 300 ký tự đầu (có thể gồm URL, body lỗi HTTP, stderr git) |
| Bài học | `docs/BAI-HOC.md` | Mỗi lỗi agent đã mắc + lớp đã sửa; lỗi lặp thì nâng lên lớp mạnh hơn |

Xem tổng hợp nhật ký:

```bash
node scripts/audit-report.mjs            # tháng hiện tại
node scripts/audit-report.mjs 2026-11
```

Kết quả: số lần gọi và lỗi theo tool, lỗi lặp nhiều nhất (ứng viên thêm vào BAI-HOC hoặc sensor), ticket phải chuyển In Review nhiều lần (bị Reopened). Lưu ý: lỗi sai tham số (vd thiếu `userConfirmed`) bị chặn trước khi tool chạy nên không có trong nhật ký.

Thêm tool mới: viết hàm trong file tương ứng, đăng ký bằng `server.registerTool(...)` trong `index.ts`, `npm run build`, khởi động lại Claude.
