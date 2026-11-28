resource "aws_security_group" "efs" {
  name_prefix = "${var.cluster_name}-efs-"
  description = "Allow NFS from EKS nodes to EFS"
  vpc_id      = aws_vpc.prod.id

  ingress {
    description = "NFS from private subnets"
    from_port   = 2049
    to_port     = 2049
    protocol    = "tcp"
    cidr_blocks = [for s in aws_subnet.private : s.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.cluster_name}-efs-sg"
  }
}

resource "aws_efs_file_system" "shared" {
  creation_token = "${var.cluster_name}-shared"
  encrypted      = true

  tags = {
    Name = "${var.cluster_name}-shared"
  }
}

resource "aws_efs_mount_target" "shared" {
  count = length(aws_subnet.private)

  file_system_id  = aws_efs_file_system.shared.id
  subnet_id       = aws_subnet.private[count.index].id
  security_groups = [aws_security_group.efs.id]
}

resource "aws_efs_access_point" "mongo_init" {
  file_system_id = aws_efs_file_system.shared.id

  posix_user {
    gid = 999
    uid = 999
  }

  root_directory {
    path = "/mongo-init-signal"
    creation_info {
      owner_gid   = 999
      owner_uid   = 999
      permissions = "755"
    }
  }

  tags = {
    Name = "${var.cluster_name}-mongo-init"
  }
}

resource "aws_efs_access_point" "backtest_data" {
  file_system_id = aws_efs_file_system.shared.id

  posix_user {
    gid = 1000
    uid = 1000
  }

  root_directory {
    path = "/backtest-data"
    creation_info {
      owner_gid   = 1000
      owner_uid   = 1000
      permissions = "755"
    }
  }

  tags = {
    Name = "${var.cluster_name}-backtest-data"
  }
}
