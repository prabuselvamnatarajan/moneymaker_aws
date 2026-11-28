terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # Partial S3 backend. bucket / key / region / use_lockfile are passed with
  # -backend-config by the GitHub workflows (and by hand, see README.md).
  # The bucket comes from terraform/bootstrap.
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "moneymaker"
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}
