terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Local state on purpose: this stack creates the S3 bucket that every
  # other stack stores its state in. Keep terraform.tfstate from this folder
  # somewhere safe (it is gitignored), or migrate it into the bucket afterwards.
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "moneymaker"
      Stack     = "bootstrap"
      ManagedBy = "terraform"
    }
  }
}
