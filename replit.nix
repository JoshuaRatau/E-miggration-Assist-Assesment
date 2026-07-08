{pkgs}: {
  deps = [
    pkgs.chromium
    pkgs.python313Packages.deep-translator
    pkgs.wkhtmltopdf
    pkgs.pandoc
  ];
}
