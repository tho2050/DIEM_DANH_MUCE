using Microsoft.Extensions.FileProviders;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Unicode;

var builder = WebApplication.CreateBuilder(args);

// Cấu hình Kestrel chạy trên cổng 5252 trên mọi địa chỉ IP (0.0.0.0) để điện thoại kết nối được
builder.WebHost.UseUrls("http://0.0.0.0:5252");

var app = builder.Build();

var fileProvider = new PhysicalFileProvider(builder.Environment.ContentRootPath);

// Thư mục dữ liệu nội bộ App_Data trên máy
var dataDir = Path.Combine(builder.Environment.ContentRootPath, "App_Data");
Directory.CreateDirectory(dataDir);
var activitiesFile = Path.Combine(dataDir, "activities.json");
var recordsFile = Path.Combine(dataDir, "records.json");
var configFile = Path.Combine(dataDir, "admin_config.json");

var jsonOptions = new JsonSerializerOptions
{
    Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
    WriteIndented = true
};

// API cung cấp thông tin IP cục bộ của server
app.MapGet("/api/server-info", () =>
{
    string localIp = "localhost";
    try
    {
        using (Socket socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, 0))
        {
            socket.Connect("8.8.8.8", 65530);
            IPEndPoint? endPoint = socket.LocalEndPoint as IPEndPoint;
            if (endPoint != null)
            {
                localIp = endPoint.Address.ToString();
            }
        }
    }
    catch
    {
        try
        {
            var host = Dns.GetHostEntry(Dns.GetHostName());
            foreach (var ip in host.AddressList)
            {
                if (ip.AddressFamily == AddressFamily.InterNetwork && !ip.ToString().StartsWith("127."))
                {
                    localIp = ip.ToString();
                    break;
                }
            }
        }
        catch { }
    }
    return Results.Json(new { localIp = localIp, port = 5252 });
});

// API chính xử lý GET /api
app.MapGet("/api", (HttpContext context) =>
{
    string action = context.Request.Query["action"].ToString() ?? "";

    if (action == "getActivities")
    {
        if (!File.Exists(activitiesFile)) return Results.Content("[]", "application/json");
        return Results.Content(File.ReadAllText(activitiesFile), "application/json");
    }

    if (action == "saveActivities")
    {
        string data = context.Request.Query["data"].ToString();
        if (!string.IsNullOrEmpty(data))
        {
            File.WriteAllText(activitiesFile, data);
        }
        return Results.Json(new { status = "success", message = "Đã lưu danh sách sự kiện thành công" });
    }

    if (action == "getRecords")
    {
        if (!File.Exists(recordsFile)) return Results.Content("[]", "application/json");
        return Results.Content(File.ReadAllText(recordsFile), "application/json");
    }

    if (action == "getAdminCode")
    {
        string code = "admin123";
        if (File.Exists(configFile))
        {
            try {
                var doc = JsonDocument.Parse(File.ReadAllText(configFile));
                if (doc.RootElement.TryGetProperty("adminCode", out var prop)) code = prop.GetString() ?? "admin123";
            } catch {}
        }
        return Results.Json(new { status = "success", code = code });
    }

    if (action == "setAdminCode")
    {
        string newCode = context.Request.Query["code"].ToString();
        File.WriteAllText(configFile, JsonSerializer.Serialize(new { adminCode = newCode }, jsonOptions));
        return Results.Json(new { status = "success", message = "Đã cập nhật mã Admin mới" });
    }

    if (action == "exportCsv")
    {
        if (!File.Exists(recordsFile))
        {
            var emptyCsv = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes("STT,Thời Gian,Mã Sự Kiện,Tên Sự Kiện,Quyền Lợi,MSSV,Họ và Tên,Lớp,Khoa,Khoảng Cách,Thiết Bị,Tọa độ sự kiện,Số Điện Thoại,Gmail,IP Máy\r\n")).ToArray();
            return Results.File(emptyCsv, "text/csv;charset=utf-8", $"Danh_Sach_Diem_Danh_{DateTime.Now:yyyyMMdd_HHmmss}.csv");
        }

        var json = File.ReadAllText(recordsFile);
        var list = JsonSerializer.Deserialize<List<Dictionary<string, object>>>(json) ?? new();
        var sb = new StringBuilder();
        sb.AppendLine("STT,Thời Gian,Mã Sự Kiện,Tên Sự Kiện,Quyền Lợi,MSSV,Họ và Tên,Lớp,Khoa,Khoảng Cách,Thiết Bị,Tọa độ sự kiện,Số Điện Thoại,Gmail,IP Máy");

        int idx = 1;
        foreach (var item in list)
        {
            string GetVal(string k) => item.TryGetValue(k, out var v) && v != null ? v.ToString() ?? "" : "";
            sb.AppendLine($"{idx++},\"{GetVal("timestamp")}\",\"{GetVal("code")}\",\"{GetVal("title")}\",\"{GetVal("benefit")}\",\"{GetVal("studentCode")}\",\"{GetVal("name")}\",\"{GetVal("className")}\",\"{GetVal("faculty")}\",\"{GetVal("distance")}\",\"{GetVal("device")}\",\"{GetVal("coords")}\",\"{GetVal("phoneNumber")}\",\"{GetVal("email")}\",\"{GetVal("ip")}\"");
        }

        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
        return Results.File(bytes, "text/csv;charset=utf-8", $"Danh_Sach_Diem_Danh_{DateTime.Now:yyyyMMdd_HHmmss}.csv");
    }

    // Mặc định trả về toàn bộ bản ghi điểm danh
    if (!File.Exists(recordsFile)) return Results.Content("[]", "application/json");
    return Results.Content(File.ReadAllText(recordsFile), "application/json");
});

// API chính xử lý POST /api
app.MapPost("/api", async (HttpContext context) =>
{
    using var reader = new StreamReader(context.Request.Body);
    var body = await reader.ReadToEndAsync();
    
    if (string.IsNullOrWhiteSpace(body))
    {
        return Results.Json(new { status = "error", message = "Dữ liệu trống" });
    }

    try
    {
        // 1. Nếu là mảng sự kiện (lưu activities)
        if (body.TrimStart().StartsWith("["))
        {
            await File.WriteAllTextAsync(activitiesFile, body);
            return Results.Json(new { status = "success", message = "Đã lưu danh sách sự kiện" });
        }

        var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        // 2. Nếu payload có thuộc tính action == saveActivities
        if (root.TryGetProperty("action", out var actionProp) && actionProp.GetString() == "saveActivities")
        {
            if (root.TryGetProperty("activities", out var actsProp))
            {
                await File.WriteAllTextAsync(activitiesFile, actsProp.GetRawText());
            }
            else
            {
                await File.WriteAllTextAsync(activitiesFile, body);
            }
            return Results.Json(new { status = "success", message = "Đã lưu danh sách sự kiện" });
        }

        // 3. Nếu là gửi điểm danh sinh viên
        var recordDict = JsonSerializer.Deserialize<Dictionary<string, object>>(body) ?? new();
        if (!recordDict.ContainsKey("timestamp"))
        {
            recordDict["timestamp"] = DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss");
        }

        List<Dictionary<string, object>> recordsList = new();
        if (File.Exists(recordsFile))
        {
            var existingJson = await File.ReadAllTextAsync(recordsFile);
            try
            {
                recordsList = JsonSerializer.Deserialize<List<Dictionary<string, object>>>(existingJson) ?? new();
            }
            catch { }
        }

        recordsList.Insert(0, recordDict);
        var updatedJson = JsonSerializer.Serialize(recordsList, jsonOptions);
        await File.WriteAllTextAsync(recordsFile, updatedJson);

        return Results.Json(new { status = "success", message = "Điểm danh thành công!" });
    }
    catch (Exception ex)
    {
        return Results.Json(new { status = "error", message = "Lỗi xử lý server: " + ex.Message });
    }
});

// Các đường dẫn REST riêng phục vụ giao diện mới
app.MapGet("/api/activities", () => {
    if (!File.Exists(activitiesFile)) return Results.Content("[]", "application/json");
    return Results.Content(File.ReadAllText(activitiesFile), "application/json");
});

app.MapPost("/api/activities", async (HttpContext context) => {
    using var reader = new StreamReader(context.Request.Body);
    var body = await reader.ReadToEndAsync();
    await File.WriteAllTextAsync(activitiesFile, body);
    return Results.Json(new { status = "success", message = "Đã lưu danh sách sự kiện" });
});

app.MapGet("/api/records", () => {
    if (!File.Exists(recordsFile)) return Results.Content("[]", "application/json");
    return Results.Content(File.ReadAllText(recordsFile), "application/json");
});

app.MapPost("/api/checkin", async (HttpContext context) => {
    using var reader = new StreamReader(context.Request.Body);
    var body = await reader.ReadToEndAsync();
    
    var recordDict = JsonSerializer.Deserialize<Dictionary<string, object>>(body) ?? new();
    if (!recordDict.ContainsKey("timestamp"))
    {
        recordDict["timestamp"] = DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss");
    }

    List<Dictionary<string, object>> recordsList = new();
    if (File.Exists(recordsFile))
    {
        var existingJson = await File.ReadAllTextAsync(recordsFile);
        try { recordsList = JsonSerializer.Deserialize<List<Dictionary<string, object>>>(existingJson) ?? new(); } catch { }
    }

    recordsList.Insert(0, recordDict);
    await File.WriteAllTextAsync(recordsFile, JsonSerializer.Serialize(recordsList, jsonOptions));

    return Results.Json(new { status = "success", message = "Điểm danh thành công!" });
});

// Middleware định tuyến thông minh (SPA Routing):
// Chuyển đổi mọi yêu cầu dạng /Activity/CheckIn/SVTN2026 hoặc /checkin/SVTN2026
// về trang checkin.html ở root để trình duyệt tải về và chạy JS tĩnh.
app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value ?? "";
    if (path.StartsWith("/Activity/CheckIn/", StringComparison.OrdinalIgnoreCase) || 
        path.StartsWith("/checkin/", StringComparison.OrdinalIgnoreCase))
    {
        context.Request.Path = "/checkin.html";
    }
    await next();
});

app.UseDefaultFiles(new DefaultFilesOptions
{
    FileProvider = fileProvider,
    DefaultFileNames = new List<string> { "index.html" }
});

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = fileProvider,
    RequestPath = ""
});

// In ra các địa chỉ IP để người dùng biết cách truy cập từ điện thoại
Console.WriteLine("==================================================================");
Console.WriteLine("Web server C# Backend dang chay!");
Console.WriteLine("- Truy cap tren may tinh: http://localhost:5252");
try
{
    var host = Dns.GetHostEntry(Dns.GetHostName());
    foreach (var ip in host.AddressList)
    {
        if (ip.AddressFamily == AddressFamily.InterNetwork && !ip.ToString().StartsWith("127."))
        {
            Console.WriteLine($"- Truy cap tu dien thoai (cung Wi-Fi): http://{ip}:5252");
        }
    }
}
catch { }
Console.WriteLine("==================================================================");

app.Run();
