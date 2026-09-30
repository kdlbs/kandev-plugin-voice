#!/bin/sh
set -eu

fail() {
	printf 'release version verification failed: %s\n' "$1" >&2
	exit 1
}

check_minimum_kandev_version() {
	declared=$1
	source=$2
	case "$declared" in
		v*) ;;
		*) fail "$source min_kandev_version must retain its leading v prefix" ;;
	esac
	version=${declared#v}
	printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "$source min_kandev_version is not a release version: $declared"
	satisfies_floor=$(printf '%s\n' "$version" | awk -F. '{ if (($1 + 0) > 0 || (($1 + 0) == 0 && ($2 + 0) >= 88)) print "yes"; else print "no" }')
	[ "$satisfies_floor" = yes ] || fail "$source min_kandev_version must be at least v0.88.0 (found $declared)"
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
	fail 'usage: verify-release-version.sh TAG [PACKAGE_FILE]'
fi

tag=$1
if ! printf '%s\n' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
	fail "tag is not a release version: $tag"
fi

tag_version=${tag#v}
manifest_version=$(sed -nE 's/^version: "([0-9]+\.[0-9]+\.[0-9]+)"$/\1/p' manifest.yaml)
minimum_kandev_declared=$(sed -nE 's/^min_kandev_version: "(v?[0-9]+\.[0-9]+\.[0-9]+)"$/\1/p' manifest.yaml)
make_version=$(sed -nE 's/^VERSION := ([0-9]+\.[0-9]+\.[0-9]+)$/\1/p' Makefile)
[ -n "$manifest_version" ] || fail 'manifest.yaml has no SemVer version'
[ -n "$make_version" ] || fail 'Makefile has no SemVer VERSION'
check_minimum_kandev_version "$minimum_kandev_declared" manifest.yaml
[ "$manifest_version" = "$make_version" ] || fail "manifest version $manifest_version differs from Makefile version $make_version"
[ "$tag_version" = "$manifest_version" ] || fail "tag $tag differs from manifest version $manifest_version"

if [ "$#" -eq 2 ]; then
	package_file=$2
	expected_package=$(make --no-print-directory -s package-file)
	[ -f "$package_file" ] || fail "package file not found: $package_file"
	[ "$(basename "$package_file")" = "$expected_package" ] || fail "package filename $(basename "$package_file") differs from $expected_package"
	package_manifest=$(tar -xOzf "$package_file" manifest.yaml | sed -nE 's/^version: "([0-9]+\.[0-9]+\.[0-9]+)"$/\1/p')
	[ "$package_manifest" = "$tag_version" ] || fail "package manifest version ${package_manifest:-missing} differs from tag $tag"
	package_minimum_declared=$(tar -xOzf "$package_file" manifest.yaml | sed -nE 's/^min_kandev_version: "(v?[0-9]+\.[0-9]+\.[0-9]+)"$/\1/p')
	check_minimum_kandev_version "$package_minimum_declared" 'package manifest'
fi
