{pkgs}: {
  deps = [
    pkgs.python313Packages.deep-translator
    pkgs.wkhtmltopdf
    pkgs.pandoc
  ];
}
