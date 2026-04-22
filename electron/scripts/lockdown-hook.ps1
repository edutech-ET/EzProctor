param(
    [string]$StatusFile = "",
    [string]$LogFile = ""
)

function Write-HookStatus {
    param([string]$Message)

    if ($LogFile) {
        Add-Content -Path $LogFile -Value $Message
    }
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;
using System.Windows.Forms;

public static class SecureKeyboardHook
{
    private static IntPtr _hookId = IntPtr.Zero;
    private static LowLevelKeyboardProc _proc = HookCallback;

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int VK_TAB = 0x09;
    private const int VK_ESCAPE = 0x1B;
    private const int VK_F4 = 0x73;
    private const int VK_SPACE = 0x20;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int VK_APPS = 0x5D;
    private const int VK_MENU = 0x12;
    private const int VK_CONTROL = 0x11;
    private const int VK_SHIFT = 0x10;

    public static void Run()
    {
        _hookId = SetHook(_proc);
        if (_hookId == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "SetWindowsHookEx failed");
        }
        Application.Run();
        UnhookWindowsHookEx(_hookId);
    }

    public static bool IsReady()
    {
        return _hookId != IntPtr.Zero;
    }

    private static IntPtr SetHook(LowLevelKeyboardProc proc)
    {
        return SetWindowsHookEx(WH_KEYBOARD_LL, proc, IntPtr.Zero, 0);
    }

    private static bool IsPressed(int keyCode)
    {
        return (GetAsyncKeyState(keyCode) & 0x8000) != 0;
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN))
        {
            int vkCode = Marshal.ReadInt32(lParam);
            bool altPressed = IsPressed(VK_MENU);
            bool ctrlPressed = IsPressed(VK_CONTROL);
            bool shiftPressed = IsPressed(VK_SHIFT);

            if (vkCode == VK_LWIN || vkCode == VK_RWIN)
            {
                return (IntPtr)1;
            }

            if ((vkCode == VK_TAB && altPressed) ||
                (vkCode == VK_ESCAPE && altPressed) ||
                (vkCode == VK_ESCAPE && ctrlPressed) ||
                (vkCode == VK_ESCAPE && ctrlPressed && shiftPressed) ||
                (vkCode == VK_F4 && altPressed) ||
                (vkCode == VK_SPACE && altPressed) ||
                (vkCode == VK_APPS))
            {
                return (IntPtr)1;
            }
        }

        return CallNextHookEx(_hookId, nCode, wParam, lParam);
    }
}
"@ -ReferencedAssemblies System.Windows.Forms

try {
    if ($StatusFile) {
        Set-Content -Path $StatusFile -Value "starting"
    }

    Write-HookStatus "Starting hook helper"
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 300
    $timer.Add_Tick({
        if ([SecureKeyboardHook]::IsReady()) {
            if ($StatusFile) {
                Set-Content -Path $StatusFile -Value "ready"
            }
            Write-HookStatus "Hook ready"
            $timer.Stop()
        }
    })
    $timer.Start()
    [SecureKeyboardHook]::Run()
}
catch {
    Write-HookStatus $_.Exception.ToString()
    if ($StatusFile) {
        Set-Content -Path $StatusFile -Value ("error:" + $_.Exception.Message)
    }
    throw
}
