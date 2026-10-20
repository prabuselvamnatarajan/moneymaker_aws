terraform {
  required_version = ">= 1.5.0"

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

  # Configure a remote backend before apply, for example:
  # backend "s3" {
  #   bucket = "your-tf-state-bucket"
  #   key    = "moneymaker/prod/terraform.tfstate"
  #   region = "ap-south-1"
  # }
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
