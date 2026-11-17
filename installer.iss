; Minimalist Silent Bootstrapper for Black hole Browser Setup
#define MyAppName "Black hole Browser Setup"
#define MyAppVersion "1.15.0"
#define MyAppPublisher "Karasu x Gemini"
#define MyAppExeName "Black hole Browser Setup.exe"

[Setup]
AppId={{C7684613-2E1A-4C2E-83F3-A5B2B8FE547A}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={tmp}\BlackHoleSetup
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableFinishedPage=yes
DisableWelcomePage=yes
ShowLanguageDialog=no
OutputDir=output_installer
OutputBaseFilename=Black_Hole_Browser_Setup_v1.15.0
SetupIconFile=icon.ico
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
Uninstallable=no

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Files]
Source: "dist_installer\Black hole Browser Setup-win32-x64\*"; DestDir: "{tmp}\BlackHoleSetup"; Flags: ignoreversion recursesubdirs createallsubdirs dontcopy

[Code]
function ShowWindow(hWnd: HWND; nCmdShow: Integer): BOOL;
external 'ShowWindow@user32.dll stdcall';

function SetWindowLong(hWnd: HWND; nIndex: Integer; dwNewLong: Longint): Longint;
external 'SetWindowLongW@user32.dll stdcall';

function GetWindowLong(hWnd: HWND; nIndex: Integer): Longint;
external 'GetWindowLongW@user32.dll stdcall';

function FindWindow(lpClassName, lpWindowName: String): HWND;
external 'FindWindowW@user32.dll stdcall';

const
  GWL_EXSTYLE = -20;
  WS_EX_TOOLWINDOW = $00000080;
  WS_EX_APPWINDOW = $00040000;

procedure HideInnoTaskbarAndWindows();
var
  H: HWND;
begin
  try
    if MainForm <> nil then
    begin
      ShowWindow(MainForm.Handle, SW_HIDE);
      SetWindowLong(MainForm.Handle, GWL_EXSTYLE, (GetWindowLong(MainForm.Handle, GWL_EXSTYLE) or WS_EX_TOOLWINDOW) and not WS_EX_APPWINDOW);
      ShowWindow(MainForm.Handle, SW_HIDE);
    end;
  except
  end;
  try
    H := FindWindow('TApplication', 'Установка');
    if H <> 0 then
    begin
      ShowWindow(H, SW_HIDE);
      SetWindowLong(H, GWL_EXSTYLE, (GetWindowLong(H, GWL_EXSTYLE) or WS_EX_TOOLWINDOW) and not WS_EX_APPWINDOW);
      ShowWindow(H, SW_HIDE);
    end;
    H := FindWindow('TApplication', ExpandConstant('{#MyAppName}'));
    if H <> 0 then
    begin
      ShowWindow(H, SW_HIDE);
      SetWindowLong(H, GWL_EXSTYLE, (GetWindowLong(H, GWL_EXSTYLE) or WS_EX_TOOLWINDOW) and not WS_EX_APPWINDOW);
      ShowWindow(H, SW_HIDE);
    end;
  except
  end;
end;

function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  // Hide Inno Setup taskbar button and windows immediately
  HideInnoTaskbarAndWindows();

  // 1. Extract all installer files directly into {tmp}\BlackHoleSetup without showing any dialogs
  ExtractTemporaryFiles('*');
  
  // Ensure Inno Setup remains completely hidden
  HideInnoTaskbarAndWindows();

  // 2. Launch the custom minimalist Black Hole installer with video loop
  Exec(ExpandConstant('{tmp}\BlackHoleSetup\Black hole Browser Setup.exe'), '', '', SW_SHOW, ewWaitUntilTerminated, ResultCode);
  
  // 3. Terminate Inno Setup silently (custom installer handles everything)
  Result := False;
end;
