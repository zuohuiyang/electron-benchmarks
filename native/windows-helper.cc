#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cwchar>
#include <climits>
#include <wtsapi32.h>
#include <psapi.h>
#include <intrin.h>
#include <string>
#include <cstring>
#include <vector>

using QueryProcess = LONG(NTAPI*)(HANDLE, ULONG, PVOID, ULONG, PULONG);
using QuerySystem = LONG(NTAPI*)(ULONG, PVOID, ULONG, PULONG);
static DWORD Priority(HANDLE process, ULONG kind) {
  auto query = reinterpret_cast<QueryProcess>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryInformationProcess"));
  DWORD value = 0, returned = 0;
  if (!query || query(process, kind, &value, sizeof(value), &returned) != 0 || returned != sizeof(value)) return 0;
  return value;
}
static bool Elevated() {
  HANDLE token{};
  TOKEN_ELEVATION elevation{};
  DWORD bytes{};
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return true;
  const BOOL ok = GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &bytes);
  CloseHandle(token);
  return !ok || elevation.TokenIsElevated;
}
static std::string Sid() {
  HANDLE token{};
  DWORD bytes{};
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return "";
  GetTokenInformation(token, TokenUser, nullptr, 0, &bytes);
  auto buffer = new BYTE[bytes];
  std::string sid;
  if (GetTokenInformation(token, TokenUser, buffer, bytes, &bytes)) {
    PSID s = reinterpret_cast<TOKEN_USER*>(buffer)->User.Sid;
    const auto authority = GetSidIdentifierAuthority(s);
    unsigned long long auth = 0;
    for (BYTE b : authority->Value) auth = (auth << 8) | b;
    sid = "S-1-" + std::to_string(auth);
    for (int i = 0; i < *GetSidSubAuthorityCount(s); ++i) sid += "-" + std::to_string(*GetSidSubAuthority(s, i));
  }
  delete[] buffer;
  CloseHandle(token);
  return sid;
}
static bool Desktop() {
  HDESK desk = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
  if (!desk) return false;
  wchar_t name[256]{}; DWORD size{};
  const BOOL ok = GetUserObjectInformationW(desk, UOI_NAME, name, sizeof(name), &size);
  CloseDesktop(desk);
  return ok && std::wcscmp(name, L"Default") == 0;
}
static DWORD Sessions() {
  WTS_SESSION_INFOW* sessions{}; DWORD count{}, users{};
  if (!WTSEnumerateSessionsW(WTS_CURRENT_SERVER_HANDLE, 0, 1, &sessions, &count)) return 999;
  for (DWORD i = 0; i < count; ++i) {
    if (sessions[i].State != WTSActive) continue;
    LPWSTR user{}; DWORD bytes{};
    if (WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE, sessions[i].SessionId, WTSUserName, &user, &bytes)) {
      if (user && user[0]) ++users;
      WTSFreeMemory(user);
    }
  }
  WTSFreeMemory(sessions);
  return users;
}

static uint64_t Value(FILETIME value) {
  return (static_cast<uint64_t>(value.dwHighDateTime) << 32) | value.dwLowDateTime;
}

static int ObserveCpu(const wchar_t* pid_list) {
  std::vector<HANDLE> handles;
  std::vector<DWORD> pids;
  std::wstring list(pid_list); size_t offset = 0;
  while (offset < list.size()) {
    size_t end = list.find(L',', offset);
    DWORD pid = static_cast<DWORD>(std::wcstoul(list.substr(offset, end - offset).c_str(), nullptr, 10));
    HANDLE handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!pid || !handle) return 10;
    handles.push_back(handle); pids.push_back(pid);
    if (end == std::wstring::npos) break;
    offset = end + 1;
  }
  if (handles.empty()) return 11;
  std::vector<uint64_t> before;
  for (HANDLE handle : handles) {
    FILETIME c{}, e{}, k{}, u{};
    if (!GetProcessTimes(handle, &c, &e, &k, &u)) return 12;
    before.push_back(Value(k) + Value(u));
  }
  LARGE_INTEGER start{}, finish{}, frequency{};
  QueryPerformanceFrequency(&frequency); QueryPerformanceCounter(&start);
  Sleep(20000);
  QueryPerformanceCounter(&finish);
  std::printf("{\"durationSeconds\":%.9f,\"logicalCpus\":%lu,\"processes\":[", static_cast<double>(finish.QuadPart - start.QuadPart) / frequency.QuadPart, GetActiveProcessorCount(ALL_PROCESSOR_GROUPS));
  for (size_t i = 0; i < handles.size(); ++i) {
    FILETIME c{}, e{}, k{}, u{}; DWORD exit_code{};
    if (!GetProcessTimes(handles[i], &c, &e, &k, &u) || !GetExitCodeProcess(handles[i], &exit_code) || exit_code != STILL_ACTIVE) return 13;
    const uint64_t after = Value(k) + Value(u);
    if (after < before[i]) return 14;
    std::printf("%s{\"pid\":%lu,\"creationFileTime100ns\":\"%llu\",\"cpuBefore100ns\":\"%llu\",\"cpuAfter100ns\":\"%llu\"}", i ? "," : "", pids[i], static_cast<unsigned long long>(Value(c)), static_cast<unsigned long long>(before[i]), static_cast<unsigned long long>(after));
    CloseHandle(handles[i]);
  }
  std::printf("]}\n"); return 0;
}

// Read-only post-endpoint helper: common Windows QPC + precise FILETIME bridge.
int wmain(int argc, wchar_t** argv) {
  if (argc == 3 && std::wcscmp(argv[1], L"--observe-cpu") == 0) return ObserveCpu(argv[2]);
  const DWORD pid = argc == 2 ? static_cast<DWORD>(std::wcstoul(argv[1], nullptr, 10)) : GetCurrentProcessId();
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) return 1;
  FILETIME creation{}, exit{}, kernel{}, user{};
  if (!GetProcessTimes(process, &creation, &exit, &kernel, &user)) {
    CloseHandle(process);
    return 2;
  }
  const DWORD cpu_priority = GetPriorityClass(process);
  const DWORD io_priority = Priority(process, 33), memory_priority = Priority(process, 39);
  IO_COUNTERS io{};
  if (!GetProcessIoCounters(process, &io)) { CloseHandle(process); return 4; }
  CloseHandle(process);
  LARGE_INTEGER frequency{}, before{}, after{}, best_before{}, best_after{};
  FILETIME utc{}, best_utc{};
  if (!QueryPerformanceFrequency(&frequency)) return 3;
  LONGLONG minimum = LLONG_MAX;
  for (int i = 0; i < 32; ++i) {
    QueryPerformanceCounter(&before);
    GetSystemTimePreciseAsFileTime(&utc);
    QueryPerformanceCounter(&after);
    if (after.QuadPart - before.QuadPart < minimum) {
      minimum = after.QuadPart - before.QuadPart;
      best_before = before;
      best_after = after;
      best_utc = utc;
    }
  }
  unsigned char time_info[48]{};
  auto query_system = reinterpret_cast<QuerySystem>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQuerySystemInformation"));
  if (!query_system || query_system(3, time_info, sizeof(time_info), nullptr) != 0) return 5;
  unsigned long long boot{};
  std::memcpy(&boot, time_info, sizeof(boot));
  FILETIME idle{}, system_kernel{}, system_user{};
  if (!GetSystemTimes(&idle, &system_kernel, &system_user)) return 6;
  DWORD session{};
  if (!ProcessIdToSessionId(GetCurrentProcessId(), &session)) return 7;
  int cpu_info[4]{}; __cpuid(cpu_info, 1);
  const std::string sid = Sid();
  std::printf("{\"pid\":%lu,\"frequency\":\"%lld\",\"qpcBefore\":\"%lld\","
              "\"qpcAfter\":\"%lld\",\"utcFileTime100ns\":\"%llu\","
              "\"creationFileTime100ns\":\"%llu\","
              "\"cpuPriority\":%lu,\"ioPriority\":%lu,\"memoryPriority\":%lu,"
              "\"readBytes\":\"%llu\",\"writeBytes\":\"%llu\","
              "\"bootId\":\"%llu\",\"uptimeSeconds\":%.3f,"
              "\"idleTime\":\"%llu\",\"kernelTime\":\"%llu\",\"userTime\":\"%llu\","
              "\"elevated\":%s,\"desktop\":\"%s\",\"sessionId\":%lu,"
              "\"interactiveSessions\":%lu,\"userSid\":\"%s\",\"virtualized\":%s}\n",
              pid, frequency.QuadPart, best_before.QuadPart, best_after.QuadPart,
              static_cast<unsigned long long>(Value(best_utc)),
              static_cast<unsigned long long>(Value(creation)), cpu_priority, io_priority, memory_priority,
              static_cast<unsigned long long>(io.ReadTransferCount), static_cast<unsigned long long>(io.WriteTransferCount),
              boot, static_cast<double>(GetTickCount64()) / 1000,
              static_cast<unsigned long long>(Value(idle)), static_cast<unsigned long long>(Value(system_kernel)),
              static_cast<unsigned long long>(Value(system_user)), Elevated() ? "true" : "false", Desktop() ? "Default" : "Unavailable",
              session, Sessions(), sid.c_str(), (cpu_info[2] & (1 << 31)) ? "true" : "false");
  return 0;
}
