source "https://rubygems.org"

# Match the GitHub Pages build environment (github-pages 232 = Jekyll 3.10,
# Ruby 3.3.4). Older releases cannot be installed or run on Ruby 3.2+.
gem 'github-pages', '>= 232'
# html-proofer 4+ renamed its CLI flags (see script/cibuild).
gem 'html-proofer', '>= 5.0'
gem 'tzinfo-data', platforms: [:windows]

# Gemfile.lock is resolved for Ruby 3.2+, so it installs unchanged on the
# Ruby 3.2 that GitHub-hosted runners ship as well as on Ruby 3.3.
