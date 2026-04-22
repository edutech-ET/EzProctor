#include <napi.h>
#include <windows.h>

namespace {

HHOOK g_keyboard_hook = nullptr;
HANDLE g_hook_thread = nullptr;
DWORD g_thread_id = 0;

LRESULT CALLBACK KeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode >= 0 && (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN)) {
    auto* kbd = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);

    if (kbd->vkCode == VK_LWIN || kbd->vkCode == VK_RWIN) {
      return 1;
    }

    if (kbd->vkCode == VK_TAB && (GetAsyncKeyState(VK_MENU) & 0x8000)) {
      return 1;
    }

    if (kbd->vkCode == VK_ESCAPE && (GetAsyncKeyState(VK_CONTROL) & 0x8000)) {
      return 1;
    }
  }

  return CallNextHookEx(g_keyboard_hook, nCode, wParam, lParam);
}

DWORD WINAPI HookThread(LPVOID) {
  MSG msg;

  g_keyboard_hook = SetWindowsHookEx(WH_KEYBOARD_LL, KeyboardProc, nullptr, 0);
  if (!g_keyboard_hook) {
    return 1;
  }

  while (GetMessage(&msg, nullptr, 0, 0)) {
    TranslateMessage(&msg);
    DispatchMessage(&msg);
  }

  UnhookWindowsHookEx(g_keyboard_hook);
  g_keyboard_hook = nullptr;
  return 0;
}

Napi::Value StartHook(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (g_hook_thread) {
    return Napi::Boolean::New(env, true);
  }

  g_hook_thread = CreateThread(nullptr, 0, HookThread, nullptr, 0, &g_thread_id);

  if (!g_hook_thread) {
    Napi::Error::New(env, "Failed to create keyboard hook thread").ThrowAsJavaScriptException();
    return env.Null();
  }

  return Napi::Boolean::New(env, true);
}

Napi::Value StopHook(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (g_thread_id != 0) {
    PostThreadMessage(g_thread_id, WM_QUIT, 0, 0);
  }

  if (g_hook_thread) {
    WaitForSingleObject(g_hook_thread, 2000);
    CloseHandle(g_hook_thread);
  }

  g_hook_thread = nullptr;
  g_thread_id = 0;

  return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("startHook", Napi::Function::New(env, StartHook));
  exports.Set("stopHook", Napi::Function::New(env, StopHook));
  return exports;
}

}  // namespace

NODE_API_MODULE(keyboard_hook, Init)
