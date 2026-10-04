; Inno Setup script for the self-contained Windows build.
; CI compiles this with: ISCC.exe /DMyAppVersion=1.2.3 installer\Logger.iss

#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif

#define MyAppName "Logger"
#define MyAppPublisher "Personal Logger"
#define MyAppExeName "Logger.Windows.exe"

[Setup]
AppId={{7C4E9A12-6B8D-4F0E-9A33-1D5C8E2B47F6}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\Logger
DefaultGroupName=Logger
DisableProgramGroupPage=yes
OutputDir=..\artifacts
OutputBaseFilename=Logger-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=yes
RestartApplications=no

[Files]
Source: "..\artifacts\win-publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Logger"; Filename: "{app}\{#MyAppExeName}"
Name: "{userdesktop}\Logger"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop icon"; GroupDescription: "Additional icons:"; Flags: unchecked

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch Logger"; Flags: nowait postinstall skipifsilent
