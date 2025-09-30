import React, { useEffect, useState } from 'react';
import { Card, Table, Spinner } from 'react-bootstrap';

const BackTest = ({ appAddress }) => {
  const [account, setAccount] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${appAddress}/client/backtest/accounts`).then(res => res.json()),
      fetch(`${appAddress}/client/transactions`).then(res => res.json())
    ]).then(([accData, txData]) => {
      setAccount(accData.accounts[0]);
      setTransactions(txData.transactions);
      setLoading(false);
    });
  }, [appAddress]);

  if (loading) {
    return <div className="d-flex justify-content-center align-items-center" style={{ minHeight: 200 }}><Spinner animation="border" /></div>;
  }

  return (
    <div className="container-fluid">
      <Card className="mb-4 shadow-sm">
        <Card.Body>
          <Card.Title>Demo Backtest Account</Card.Title>
          <div className="row">
            <div className="col-md-6">
              <p><strong>Account Name:</strong> {account.account_name}</p>
              <p><strong>Money:</strong> ${account.money.toLocaleString()}</p>
              <p><strong>Account Owner:</strong> {account.account_owner}</p>
              <p><strong>Created At:</strong> {account.created_at}</p>
            </div>
            <div className="col-md-6">
              <p><strong>Active Strategies:</strong></p>
              <ul>
                {account.active_strategies.map(s => (
                  <li key={s.strategy_id}>{s.strategy_name}</li>
                ))}
              </ul>
            </div>
          </div>
        </Card.Body>
      </Card>
      <Card className="shadow-sm">
        <Card.Body>
          <Card.Title>Transactions</Card.Title>
          <div className="transaction-table-scroll">
            <Table hover className="mb-0 transaction-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Strategy</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx.transaction_id}>
                    <td>{tx.transaction_id}</td>
                    <td>{tx.date}</td>
                    <td>{tx.type}</td>
                    <td>${tx.amount.toLocaleString()}</td>
                    <td>{tx.strategy}</td>
                    <td>{tx.status}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

export default BackTest;
